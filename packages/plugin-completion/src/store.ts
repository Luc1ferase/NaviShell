/**
 * Per-terminal input tracking, per-server history and the popup state machine.
 *
 * The plugin never reads the real shell buffer (it cannot), so it maintains its own idea of
 * the current input line from `terminal.onInput` and gives up (clears the line and hides the
 * popup) whenever something happens that could desynchronise it: escape sequences, Tab,
 * Ctrl-C/Ctrl-U or multi-line remote output.
 *
 * History is grouped per server for SSH terminals and under a single `local` key for local
 * shells, which have no server to belong to. Remote-only work (executables on `PATH`, cwd
 * tracking, directory listings) lives in `./remote` and is skipped for local terminals.
 *
 * Commands reach that history by two routes. The line reconstructed from keystrokes is held
 * for a moment when Enter is pressed; if the shell then reports what it is really running
 * (OSC 633 `E`, which needs shell integration), the exact text replaces the pending guess,
 * and a command that turns out to exit 127 is dropped again - it does not exist.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type {
  CursorPixelPosition,
  JsonValue,
  PluginContext,
  TerminalHandle,
} from '@navishell/plugin-api';
import { dictionary } from './dictionary';
import { analyzeToken, parseRemoteHistory, pushHistory, suggest } from './engine';
import type { Suggestion } from './engine';
import { RemoteIndex } from './remote';

export interface CompletionSettings {
  enabled: boolean;
  /** Minimum tracked-line length before suggestions appear. */
  minChars: number;
  maxItems: number;
  /**
   * Opt-in: inject a `PROMPT_COMMAND`/`precmd` hook into new SSH shells so they report
   * their working directory (OSC 7), the commands they run (OSC 633 `E`) and the exit
   * codes (OSC 133 `D`) - what makes path completion and history capture exact.
   */
  shellIntegration: boolean;
}

export const DEFAULT_SETTINGS: CompletionSettings = {
  enabled: true,
  minChars: 2,
  maxItems: 8,
  shellIntegration: false,
};

/** Hard cap of stored history entries per history key. */
const HISTORY_CAP = 2000;
/** Remote seeding command; failures are ignored. */
const SEED_COMMAND =
  'tail -n 500 ~/.bash_history 2>/dev/null; tail -n 500 ~/.zsh_history 2>/dev/null';
const PERSIST_DEBOUNCE_MS = 400;
/** History key shared by every local shell terminal. */
const LOCAL_HISTORY_KEY = 'local';
/**
 * How long a keystroke-tracked line waits before it is recorded, leaving room for the
 * shell's own report of the same command (one round trip away) to replace it.
 */
const TYPED_GRACE_MS = 600;
/** The same wait once a terminal is known to report commands: enough for a slow link. */
const TYPED_GRACE_EXACT_MS = 2500;
/** How long an exact command waits for its OSC 133 `D` exit code before being recorded. */
const EXIT_GRACE_MS = 400;
/** `command not found`: never worth keeping as a suggestion. */
const EXIT_CODE_NOT_FOUND = 127;

export interface TerminalCompletionState {
  /** Our reconstruction of the current input line. */
  line: string;
  visible: boolean;
  suggestions: Suggestion[];
  selected: number;
  cursor: CursorPixelPosition | null;
  container: { width: number; height: number };
  /** A shell integration is reporting in this terminal (an OSC 133/633 report arrived). */
  integrationActive: boolean;
}

/** A command seen but not recorded yet; see {@link CompletionController.pendTyped}. */
interface PendingCommand {
  /** The history bucket it belongs to, resolved when the command was seen. */
  key: string;
  command: string;
  timer: ReturnType<typeof setTimeout>;
}

const HIDDEN: TerminalCompletionState = {
  line: '',
  visible: false,
  suggestions: [],
  selected: 0,
  cursor: null,
  container: { width: 0, height: 0 },
  integrationActive: false,
};

/** State shared by the overlay and the history panel. */
export interface SharedState {
  settings: CompletionSettings;
  /** History bucket of the active terminal: a server id, or `local`. */
  activeHistoryKey: string | null;
  activeTerminalId: string | null;
  /** Bumped whenever any history list changes, so subscribers re-render. */
  revision: number;
}

const EMPTY_HISTORY: readonly string[] = [];

function isPrintable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

/** Which history bucket a terminal records into. Local shells share one bucket. */
function historyKey(terminal: TerminalHandle): string {
  if (terminal.kind === 'local') return LOCAL_HISTORY_KEY;
  return terminal.serverId ?? 'unknown';
}

export class CompletionController {
  private shared: SharedState = {
    settings: DEFAULT_SETTINGS,
    activeHistoryKey: null,
    activeTerminalId: null,
    revision: 0,
  };
  private readonly states = new Map<string, TerminalCompletionState>();
  private readonly histories = new Map<string, readonly string[]>();
  private readonly terminals = new Map<string, TerminalHandle>();
  private readonly tracked = new Map<string, (() => void)[]>();
  private readonly loaded = new Set<string>();
  private readonly seeded = new Set<string>();
  private readonly started = new Set<string>();
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingTyped = new Map<string, PendingCommand>();
  private readonly pendingExact = new Map<string, PendingCommand>();
  private readonly listeners = new Set<() => void>();
  private readonly remote: RemoteIndex;
  private disposed = false;

  constructor(private readonly ctx: PluginContext) {
    this.remote = new RemoteIndex(ctx, {
      onChange: this.onRemoteData,
      onIntegrationActive: this.onIntegrationActive,
      onExactCommand: this.onExactCommand,
      onCommandExit: this.onCommandExit,
    });
  }

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

  /** The popup-is-hidden state for one terminal, keeping the facts that outlive it. */
  private hiddenFor(terminalId: string, line = ''): TerminalCompletionState {
    const { integrationActive } = this.stateFor(terminalId);
    return { ...HIDDEN, line, integrationActive };
  }

  /** Stable snapshot of one history bucket, most recent first. */
  readonly historyFor = (key: string | null): readonly string[] => {
    if (key === null) return EMPTY_HISTORY;
    return this.histories.get(key) ?? EMPTY_HISTORY;
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
      this.patchShared({
        activeTerminalId: active.id,
        activeHistoryKey: historyKey(active),
      });
    }
    ctx.subscriptions.push(ctx.terminals.onDidOpen((terminal) => this.trackTerminal(terminal)));
    ctx.subscriptions.push(
      ctx.terminals.onDidClose((terminal) => this.untrackTerminal(terminal.id)),
    );
    ctx.subscriptions.push(
      ctx.terminals.onDidChangeActive((terminal) => {
        this.patchShared({
          activeTerminalId: terminal?.id ?? null,
          activeHistoryKey: terminal ? historyKey(terminal) : null,
        });
      }),
    );
    // A closed connection takes its executables and directory listings with it.
    ctx.subscriptions.push(
      ctx.connections.onDidChange((connections) => {
        this.remote.retainConnections(connections.map((connection) => connection.id));
      }),
    );
  }

  async start(): Promise<void> {
    const stored = await this.ctx.storage.get('settings');
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return;
    const record: Record<string, JsonValue | undefined> = stored;
    const settings: CompletionSettings = {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
      minChars:
        typeof record.minChars === 'number'
          ? Math.max(1, Math.trunc(record.minChars))
          : DEFAULT_SETTINGS.minChars,
      maxItems:
        typeof record.maxItems === 'number'
          ? Math.max(1, Math.trunc(record.maxItems))
          : DEFAULT_SETTINGS.maxItems,
      shellIntegration:
        typeof record.shellIntegration === 'boolean'
          ? record.shellIntegration
          : DEFAULT_SETTINGS.shellIntegration,
    };
    this.remote.setShellIntegration(settings.shellIntegration);
    this.patchShared({ settings });
  }

  dispose(): void {
    // Anything still in flight belongs in the history that is about to be written out.
    for (const id of [...this.tracked.keys()]) this.flushPending(id);
    for (const [key, timer] of this.persistTimers) {
      clearTimeout(timer);
      void this.persistHistory(key);
    }
    this.persistTimers.clear();
    this.disposed = true;
    for (const id of [...this.tracked.keys()]) this.untrackTerminal(id);
    this.remote.dispose();
    this.states.clear();
    this.terminals.clear();
    this.listeners.clear();
  }

  async toggle(): Promise<boolean> {
    const settings = { ...this.settings, enabled: !this.settings.enabled };
    this.patchShared({ settings });
    if (!settings.enabled) {
      for (const id of this.states.keys()) this.setState(id, this.hiddenFor(id));
    }
    await this.persistSettings(settings);
    return settings.enabled;
  }

  /**
   * Turns the cwd hook on or off. Enabling it only affects terminals opened from now on:
   * the snippet is injected right after a shell's first prompt.
   */
  async toggleShellIntegration(): Promise<boolean> {
    const settings = { ...this.settings, shellIntegration: !this.settings.shellIntegration };
    this.remote.setShellIntegration(settings.shellIntegration);
    this.patchShared({ settings });
    await this.persistSettings(settings);
    return settings.shellIntegration;
  }

  private async persistSettings(settings: CompletionSettings): Promise<void> {
    await this.ctx.storage.set('settings', { ...settings });
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
      ...this.remote.trackTerminal(terminal),
    ];
    this.tracked.set(
      terminal.id,
      subscriptions.map((subscription) => () => subscription.dispose()),
    );
    void this.ensureHistory(terminal);
  }

  private untrackTerminal(terminalId: string): void {
    // The last command of a terminal that is closing still belongs in its history.
    this.flushPending(terminalId);
    const disposers = this.tracked.get(terminalId);
    if (disposers) for (const dispose of disposers) dispose();
    this.tracked.delete(terminalId);
    this.terminals.delete(terminalId);
    this.states.delete(terminalId);
    this.started.delete(terminalId);
    this.remote.forgetTerminal(terminalId);
    this.emit();
  }

  // -- history -------------------------------------------------------------

  private setHistory(key: string, history: readonly string[]): void {
    this.histories.set(key, history);
    this.patchShared({ revision: this.shared.revision + 1 });
    this.schedulePersist(key);
  }

  private schedulePersist(key: string): void {
    const existing = this.persistTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.persistTimers.delete(key);
      void this.persistHistory(key);
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimers.set(key, timer);
  }

  private async persistHistory(key: string): Promise<void> {
    const history = this.histories.get(key);
    if (!history) return;
    try {
      await this.ctx.storage.set(`history:${key}`, [...history]);
    } catch (error) {
      this.ctx.log.warn('[completion] persist failed', error);
    }
  }

  /** Loads the stored history of a terminal's bucket and, for SSH, seeds it from the host. */
  private async ensureHistory(terminal: TerminalHandle): Promise<void> {
    const key = historyKey(terminal);
    if (!this.loaded.has(key)) {
      this.loaded.add(key);
      try {
        const stored = await this.ctx.storage.get<string[]>(`history:${key}`, []);
        if (this.disposed) return;
        if (stored.length > 0 && !this.histories.has(key)) {
          this.histories.set(key, stored);
          this.patchShared({ revision: this.shared.revision + 1 });
        }
      } catch (error) {
        this.ctx.log.warn('[completion] history load failed', error);
      }
    }
    // Local shells have no remote history files to read, and no connection to read them on.
    const { connectionId } = terminal;
    if (terminal.kind !== 'ssh' || connectionId === null || this.seeded.has(key)) return;
    this.seeded.add(key);
    void this.seedFromRemote(key, connectionId);
  }

  /** Fire-and-forget seeding from the remote shell history files. Errors are ignored. */
  private async seedFromRemote(key: string, connectionId: string): Promise<void> {
    try {
      const result = await this.ctx.connections.exec(connectionId, SEED_COMMAND, {
        timeoutMs: 15_000,
      });
      if (this.disposed) return;
      const remote = parseRemoteHistory(result.stdout);
      if (remote.length === 0) return;
      const existing = this.histories.get(key) ?? EMPTY_HISTORY;
      const seen = new Set(existing);
      const merged = [...existing];
      for (const command of remote) {
        if (seen.has(command)) continue;
        seen.add(command);
        merged.push(command);
      }
      this.setHistory(key, merged.slice(0, HISTORY_CAP));
      this.ctx.log.debug(`[completion] seeded ${remote.length} commands for ${key}`);
    } catch (error) {
      this.ctx.log.debug('[completion] history seeding skipped', error);
    }
  }

  private record(key: string, command: string): void {
    const trimmed = command.trim();
    // Mirror HISTCONTROL=ignorespace and skip single characters.
    if (trimmed.length < 2 || command.startsWith(' ')) return;
    const history = this.histories.get(key) ?? EMPTY_HISTORY;
    this.setHistory(key, pushHistory(history, trimmed, HISTORY_CAP));
  }

  /**
   * Hold a keystroke-tracked command line rather than recording it at once: the shell may
   * be about to report the same command exactly (OSC 633 `E`), and that report wins. When
   * none arrives the reconstruction is recorded, which is what keeps history working on
   * hosts without shell integration - and brings it back by itself if integration stops.
   */
  private pendTyped(terminal: TerminalHandle, command: string): void {
    const key = historyKey(terminal);
    this.clearPending(this.pendingTyped, terminal.id);
    const exact = this.remote.hasExactCapture(terminal.id);
    const timer = setTimeout(
      () => {
        this.pendingTyped.delete(terminal.id);
        this.record(key, command);
      },
      exact ? TYPED_GRACE_EXACT_MS : TYPED_GRACE_MS,
    );
    this.pendingTyped.set(terminal.id, { key, command, timer });
  }

  private clearPending(
    pending: Map<string, PendingCommand>,
    terminalId: string,
  ): PendingCommand | undefined {
    const entry = pending.get(terminalId);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    pending.delete(terminalId);
    return entry;
  }

  /** Record what a terminal still had in flight, because it (or the plugin) is going away. */
  private flushPending(terminalId: string): void {
    const exact = this.clearPending(this.pendingExact, terminalId);
    const typed = this.clearPending(this.pendingTyped, terminalId);
    const pending = exact ?? typed;
    if (pending) this.record(pending.key, pending.command);
  }

  // -- input tracking ------------------------------------------------------

  private handleInput(terminal: TerminalHandle, data: string): void {
    let line = this.stateFor(terminal.id).line;
    let abort = false;
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        if (line.trim() !== '') this.pendTyped(terminal, line);
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
      this.setState(terminal.id, this.hiddenFor(terminal.id));
      return;
    }
    this.refresh(terminal, line);
  }

  private handleOutput(terminal: TerminalHandle, data: Uint8Array): void {
    // The first output of a terminal is as close to "the prompt is up" as we can detect,
    // which is when the (opt-in) cwd hook can be installed.
    if (!this.started.has(terminal.id)) {
      this.started.add(terminal.id);
      this.remote.injectShellIntegration(terminal);
    }
    const state = this.stateFor(terminal.id);
    if (!state.visible) return;
    // Remote output that spans lines means the shell redrew: the popup position and our
    // tracked line are no longer trustworthy.
    if (data.includes(0x0a)) this.setState(terminal.id, { ...state, visible: false });
  }

  // -- shell integration reports -------------------------------------------

  /** The first report of a terminal: the popup footer says integration is live. */
  private readonly onIntegrationActive = (terminalId: string): void => {
    const state = this.stateFor(terminalId);
    if (state.integrationActive) return;
    this.setState(terminalId, { ...state, integrationActive: true });
  };

  /**
   * OSC 633 `E`: the shell named the command it is about to run, so our reconstruction of
   * that line is dropped. The exact text then waits briefly for its exit code instead of
   * being recorded at once - see {@link onCommandExit}.
   */
  private readonly onExactCommand = (terminalId: string, command: string): void => {
    if (this.disposed || command.trim() === '') return;
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    this.clearPending(this.pendingTyped, terminalId);
    // A command whose exit code never arrived clearly ran: record it before the new one.
    const previous = this.clearPending(this.pendingExact, terminalId);
    if (previous) this.record(previous.key, previous.command);
    const key = historyKey(terminal);
    const timer = setTimeout(() => {
      this.pendingExact.delete(terminalId);
      this.record(key, command);
    }, EXIT_GRACE_MS);
    this.pendingExact.set(terminalId, { key, command, timer });
  };

  /** OSC 133 `D`: the command finished. 127 means it never existed, so it is forgotten. */
  private readonly onCommandExit = (terminalId: string, exitCode: number | null): void => {
    const pending = this.clearPending(this.pendingExact, terminalId);
    if (!pending || this.disposed || exitCode === EXIT_CODE_NOT_FOUND) return;
    this.record(pending.key, pending.command);
  };

  /**
   * Remote data landed (executables, a directory listing). Recompute the terminals that
   * have something on their prompt; the tracked lines are untouched.
   *
   * A terminal the user is navigating with ↑/↓ is left alone: a recomputed list would
   * reset the selection under their fingers.
   */
  private readonly onRemoteData = (): void => {
    if (this.disposed) return;
    for (const [id, state] of [...this.states]) {
      const terminal = this.terminals.get(id);
      if (terminal && state.line !== '' && state.selected === 0) this.refresh(terminal, state.line);
    }
  };

  /** Recompute suggestions for a (possibly unchanged) line. */
  private refresh(terminal: TerminalHandle, line: string): void {
    const { settings } = this.shared;
    if (!settings.enabled) {
      this.setState(terminal.id, this.hiddenFor(terminal.id, line));
      return;
    }
    const token = analyzeToken(line);
    // Both lookups are cache reads that may start a background fetch; neither waits.
    const paths = this.remote.paths(terminal.connectionId, terminal.id, token);
    const suggestions = suggest({
      line,
      history: this.historyFor(historyKey(terminal)),
      remote: this.remote.executables(terminal.connectionId),
      dictionary: dictionary(),
      paths: paths.entries,
      token,
      pathsRelativeToHome: paths.relativeToHome,
      locale: this.ctx.i18n.locale,
      maxItems: settings.maxItems,
      minChars: settings.minChars,
    });
    if (suggestions.length === 0) {
      this.setState(terminal.id, this.hiddenFor(terminal.id, line));
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
      integrationActive: this.stateFor(terminal.id).integrationActive,
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
    this.setState(terminalId, this.hiddenFor(terminalId, suggestion.value));
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
    this.setState(terminal.id, this.hiddenFor(terminal.id, command));
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
