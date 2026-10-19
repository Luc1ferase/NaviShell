/**
 * Per-terminal input tracking, per-server history and the popup state machine.
 *
 * The plugin never reads the real shell buffer (it cannot), so it maintains its own idea of
 * the current input line from `terminal.onInput` and gives up (clears the line and hides the
 * popup) whenever something happens that could desynchronise it: escape sequences, Tab,
 * Ctrl-C/Ctrl-U or multi-line remote output.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type {
  CursorPixelPosition,
  JsonValue,
  PluginContext,
  TerminalHandle,
} from '@navishell/plugin-api';
import { dictionary } from './dictionary';
import { parseRemoteHistory, pushHistory, suggest } from './engine';
import type { Suggestion } from './engine';

export interface CompletionSettings {
  enabled: boolean;
  /** Minimum tracked-line length before suggestions appear. */
  minChars: number;
  maxItems: number;
}

export const DEFAULT_SETTINGS: CompletionSettings = { enabled: true, minChars: 2, maxItems: 8 };

/** Hard cap of stored history entries per server. */
const HISTORY_CAP = 2000;
/** Remote seeding command; failures are ignored. */
const SEED_COMMAND =
  'tail -n 500 ~/.bash_history 2>/dev/null; tail -n 500 ~/.zsh_history 2>/dev/null';
const PERSIST_DEBOUNCE_MS = 400;

export interface TerminalCompletionState {
  /** Our reconstruction of the current input line. */
  line: string;
  visible: boolean;
  suggestions: Suggestion[];
  selected: number;
  cursor: CursorPixelPosition | null;
  container: { width: number; height: number };
}

const HIDDEN: TerminalCompletionState = {
  line: '',
  visible: false,
  suggestions: [],
  selected: 0,
  cursor: null,
  container: { width: 0, height: 0 },
};

/** State shared by the overlay and the history panel. */
export interface SharedState {
  settings: CompletionSettings;
  activeServerId: string | null;
  activeTerminalId: string | null;
  /** Bumped whenever any history list changes, so subscribers re-render. */
  revision: number;
}

const EMPTY_HISTORY: readonly string[] = [];

function isPrintable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

export class CompletionController {
  private shared: SharedState = {
    settings: DEFAULT_SETTINGS,
    activeServerId: null,
    activeTerminalId: null,
    revision: 0,
  };
  private readonly states = new Map<string, TerminalCompletionState>();
  private readonly histories = new Map<string, readonly string[]>();
  private readonly terminals = new Map<string, TerminalHandle>();
  private readonly tracked = new Map<string, (() => void)[]>();
  private readonly loaded = new Set<string>();
  private readonly seeded = new Set<string>();
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly ctx: PluginContext) {}

  // -- store plumbing ------------------------------------------------------

  readonly getShared = (): SharedState => this.shared;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private patchShared(partial: Partial<SharedState>): void {
    if (this.disposed) return;
    this.shared = { ...this.shared, ...partial };
    this.emit();
  }

  /** Stable snapshot for one terminal (safe for `useSyncExternalStore`). */
  readonly stateFor = (terminalId: string | null): TerminalCompletionState => {
    if (terminalId === null) return HIDDEN;
    return this.states.get(terminalId) ?? HIDDEN;
  };

  private setState(terminalId: string, state: TerminalCompletionState): void {
    if (this.disposed) return;
    this.states.set(terminalId, state);
    this.emit();
  }

  /** Stable snapshot of one server's history, most recent first. */
  readonly historyFor = (serverId: string | null): readonly string[] => {
    if (serverId === null) return EMPTY_HISTORY;
    return this.histories.get(serverId) ?? EMPTY_HISTORY;
  };

  get settings(): CompletionSettings {
    return this.shared.settings;
  }

  // -- lifecycle -----------------------------------------------------------

  attach(): void {
    const { ctx } = this;
    for (const terminal of ctx.terminals.list()) this.trackTerminal(terminal);
    const active = ctx.terminals.getActive();
    if (active) {
      this.patchShared({ activeTerminalId: active.id, activeServerId: active.serverId });
    }
    ctx.subscriptions.push(ctx.terminals.onDidOpen((terminal) => this.trackTerminal(terminal)));
    ctx.subscriptions.push(
      ctx.terminals.onDidClose((terminal) => this.untrackTerminal(terminal.id)),
    );
    ctx.subscriptions.push(
      ctx.terminals.onDidChangeActive((terminal) => {
        this.patchShared({
          activeTerminalId: terminal?.id ?? null,
          activeServerId: terminal?.serverId ?? null,
        });
      }),
    );
  }

  async start(): Promise<void> {
    const stored = await this.ctx.storage.get('settings');
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return;
    const record: Record<string, JsonValue | undefined> = stored;
    this.patchShared({
      settings: {
        enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
        minChars:
          typeof record.minChars === 'number'
            ? Math.max(1, Math.trunc(record.minChars))
            : DEFAULT_SETTINGS.minChars,
        maxItems:
          typeof record.maxItems === 'number'
            ? Math.max(1, Math.trunc(record.maxItems))
            : DEFAULT_SETTINGS.maxItems,
      },
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    for (const id of [...this.tracked.keys()]) this.untrackTerminal(id);
    this.states.clear();
    this.terminals.clear();
    this.listeners.clear();
  }

  async toggle(): Promise<boolean> {
    const settings = { ...this.settings, enabled: !this.settings.enabled };
    this.patchShared({ settings });
    if (!settings.enabled) {
      for (const id of this.states.keys()) this.setState(id, HIDDEN);
    }
    await this.ctx.storage.set('settings', { ...settings });
    return settings.enabled;
  }

  // -- terminal wiring -----------------------------------------------------

  private trackTerminal(terminal: TerminalHandle): void {
    if (this.tracked.has(terminal.id)) return;
    this.terminals.set(terminal.id, terminal);
    this.states.set(terminal.id, HIDDEN);
    const subscriptions = [
      terminal.onInput((data) => this.handleInput(terminal, data)),
      terminal.onOutput((data) => this.handleOutput(terminal, data)),
      terminal.onDidDispose(() => this.untrackTerminal(terminal.id)),
    ];
    this.tracked.set(
      terminal.id,
      subscriptions.map((subscription) => () => subscription.dispose()),
    );
    void this.ensureHistory(terminal.serverId, terminal.connectionId);
  }

  private untrackTerminal(terminalId: string): void {
    const disposers = this.tracked.get(terminalId);
    if (disposers) for (const dispose of disposers) dispose();
    this.tracked.delete(terminalId);
    this.terminals.delete(terminalId);
    this.states.delete(terminalId);
    this.emit();
  }

  // -- history -------------------------------------------------------------

  private setHistory(serverId: string, history: readonly string[]): void {
    this.histories.set(serverId, history);
    this.patchShared({ revision: this.shared.revision + 1 });
    this.schedulePersist(serverId);
  }

  private schedulePersist(serverId: string): void {
    const existing = this.persistTimers.get(serverId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.persistTimers.delete(serverId);
      const history = this.histories.get(serverId);
      if (!history) return;
      void this.ctx.storage
        .set(`history:${serverId}`, [...history])
        .catch((error: unknown) => this.ctx.log.warn('[completion] persist failed', error));
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimers.set(serverId, timer);
  }

  private async ensureHistory(serverId: string, connectionId: string): Promise<void> {
    if (!this.loaded.has(serverId)) {
      this.loaded.add(serverId);
      try {
        const stored = await this.ctx.storage.get<string[]>(`history:${serverId}`, []);
        if (this.disposed) return;
        if (stored.length > 0 && !this.histories.has(serverId)) {
          this.histories.set(serverId, stored);
          this.patchShared({ revision: this.shared.revision + 1 });
        }
      } catch (error) {
        this.ctx.log.warn('[completion] history load failed', error);
      }
    }
    if (this.seeded.has(serverId)) return;
    this.seeded.add(serverId);
    void this.seedFromRemote(serverId, connectionId);
  }

  /** Fire-and-forget seeding from the remote shell history files. Errors are ignored. */
  private async seedFromRemote(serverId: string, connectionId: string): Promise<void> {
    try {
      const result = await this.ctx.connections.exec(connectionId, SEED_COMMAND, {
        timeoutMs: 15_000,
      });
      if (this.disposed) return;
      const remote = parseRemoteHistory(result.stdout);
      if (remote.length === 0) return;
      const existing = this.histories.get(serverId) ?? EMPTY_HISTORY;
      const seen = new Set(existing);
      const merged = [...existing];
      for (const command of remote) {
        if (seen.has(command)) continue;
        seen.add(command);
        merged.push(command);
      }
      this.setHistory(serverId, merged.slice(0, HISTORY_CAP));
      this.ctx.log.debug(`[completion] seeded ${remote.length} commands for ${serverId}`);
    } catch (error) {
      this.ctx.log.debug('[completion] history seeding skipped', error);
    }
  }

  private record(serverId: string, command: string): void {
    const trimmed = command.trim();
    // Mirror HISTCONTROL=ignorespace and skip single characters.
    if (trimmed.length < 2 || command.startsWith(' ')) return;
    const history = this.histories.get(serverId) ?? EMPTY_HISTORY;
    this.setHistory(serverId, pushHistory(history, trimmed, HISTORY_CAP));
  }

  // -- input tracking ------------------------------------------------------

  private handleInput(terminal: TerminalHandle, data: string): void {
    let line = this.stateFor(terminal.id).line;
    let abort = false;
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        if (line.trim() !== '') this.record(terminal.serverId, line);
        line = '';
        continue;
      }
      if (char === '\x7f' || char === '\b') {
        line = line.slice(0, -1);
        continue;
      }
      if (char === '\x1b' || char === '\t') {
        // Escape sequences (arrows, history search, …) and Tab completion move the real
        // cursor in ways we cannot follow: drop our copy of the line.
        line = '';
        abort = true;
        break;
      }
      if (isPrintable(char)) {
        line += char;
        continue;
      }
      // Any other control character (Ctrl-U, Ctrl-C, Ctrl-D, Ctrl-W, …) resets the line.
      line = '';
    }
    if (abort) {
      this.setState(terminal.id, HIDDEN);
      return;
    }
    this.refresh(terminal, line);
  }

  private handleOutput(terminal: TerminalHandle, data: Uint8Array): void {
    const state = this.stateFor(terminal.id);
    if (!state.visible) return;
    // Remote output that spans lines means the shell redrew: the popup position and our
    // tracked line are no longer trustworthy.
    if (data.includes(0x0a)) this.setState(terminal.id, { ...state, visible: false });
  }

  /** Recompute suggestions for a (possibly unchanged) line. */
  private refresh(terminal: TerminalHandle, line: string): void {
    const { settings } = this.shared;
    if (!settings.enabled) {
      this.setState(terminal.id, { ...HIDDEN, line });
      return;
    }
    const suggestions = suggest({
      line,
      history: this.historyFor(terminal.serverId),
      dictionary: dictionary(),
      locale: this.ctx.i18n.locale,
      maxItems: settings.maxItems,
      minChars: settings.minChars,
    });
    if (suggestions.length === 0) {
      this.setState(terminal.id, { ...HIDDEN, line });
      return;
    }
    let cursor: CursorPixelPosition | null = null;
    try {
      cursor = terminal.getCursorPixelPosition();
    } catch (error) {
      this.ctx.log.debug('[completion] cursor position unavailable', error);
    }
    this.setState(terminal.id, {
      line,
      visible: true,
      suggestions,
      selected: 0,
      cursor,
      container: {
        width: terminal.element.clientWidth,
        height: terminal.element.clientHeight,
      },
    });
  }

  // -- popup interaction ---------------------------------------------------

  hide(terminalId: string): void {
    const state = this.stateFor(terminalId);
    if (!state.visible) return;
    this.setState(terminalId, { ...state, visible: false, suggestions: [], selected: 0 });
  }

  move(terminalId: string, delta: number): void {
    const state = this.stateFor(terminalId);
    if (!state.visible || state.suggestions.length === 0) return;
    const count = state.suggestions.length;
    const selected = (state.selected + delta + count) % count;
    this.setState(terminalId, { ...state, selected });
  }

  select(terminalId: string, index: number): void {
    const state = this.stateFor(terminalId);
    if (!state.visible || index < 0 || index >= state.suggestions.length) return;
    this.setState(terminalId, { ...state, selected: index });
  }

  /**
   * Replace the remote input line with the selected candidate: Ctrl-U clears whatever the
   * shell has, then the full command is sent. Nothing is executed.
   */
  async accept(terminalId: string, index?: number): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    const state = this.stateFor(terminalId);
    if (!terminal || !state.visible) return;
    const suggestion = state.suggestions[index ?? state.selected];
    if (!suggestion) return;
    // Keep our tracked line in sync with what the shell now holds, and hide the popup.
    this.setState(terminalId, { ...HIDDEN, line: suggestion.value });
    try {
      await terminal.write(`\x15${suggestion.value}`);
    } catch (error) {
      this.ctx.log.warn('[completion] write failed', error);
    }
    terminal.focus();
  }

  /**
   * Keyboard interception; `false` swallows the event. Never swallows while the popup is
   * hidden, and never for `keypress`/`keyup` (xterm passes those to custom handlers too).
   *
   * Swallowed keys are also `preventDefault()`-ed: without it the browser would still emit
   * the `keypress` that follows a `keydown`, and xterm would send Enter to the shell -
   * accepting a candidate must never execute it.
   */
  readonly handleKey = (terminal: TerminalHandle, event: KeyboardEvent): boolean => {
    if (event.type !== 'keydown') return true;
    const state = this.stateFor(terminal.id);
    if (!state.visible || state.suggestions.length === 0) return true;
    if (event.ctrlKey || event.altKey || event.metaKey) return true;
    const swallow = (): boolean => {
      event.preventDefault();
      return false;
    };
    switch (event.key) {
      case 'ArrowUp':
        this.move(terminal.id, -1);
        return swallow();
      case 'ArrowDown':
        this.move(terminal.id, 1);
        return swallow();
      case 'Tab':
      case 'ArrowRight':
      case 'Enter':
        void this.accept(terminal.id);
        return swallow();
      case 'Escape':
        this.hide(terminal.id);
        return swallow();
      default:
        return true;
    }
  };

  /** Used by the history panel: put a command on the active terminal's prompt. */
  async insertIntoActive(command: string): Promise<void> {
    const terminalId = this.shared.activeTerminalId;
    const terminal = terminalId ? this.terminals.get(terminalId) : undefined;
    if (!terminal) return;
    this.setState(terminal.id, { ...HIDDEN, line: command });
    await terminal.write(`\x15${command}`);
    terminal.focus();
  }
}

export function useSharedState(controller: CompletionController): SharedState {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const snapshot = useCallback(() => controller.getShared(), [controller]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useTerminalState(
  controller: CompletionController,
  terminalId: string,
): TerminalCompletionState {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const snapshot = useCallback(() => controller.stateFor(terminalId), [controller, terminalId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
