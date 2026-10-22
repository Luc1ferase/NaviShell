/**
 * xterm.js session bound to one PTY: a remote SSH shell or a local shell.
 *
 * The DOM (container + overlay layer) is created up front and lives independently of
 * React: `TerminalPanel` only adopts `session.element` on mount and releases it on
 * unmount, so hiding or moving a dock panel never destroys the terminal.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import type {
  CursorPixelPosition,
  Disposable,
  TerminalHandle,
  TerminalKind,
} from '@navishell/plugin-api';

import { Channel, call } from '../ipc/client';
import type { TerminalRightClick, TerminalSettings } from '../ipc/contract';
import { createEmitter } from '../util/events';
import { debounce } from '../util/fn';
import { terminalTheme } from './theme';

export interface TerminalSessionOptions {
  /** `ssh` terminals belong to a connection; `local` ones run a shell on this machine. */
  kind: TerminalKind;
  /** `null` for local terminals. */
  serverId: string | null;
  /** Tab label: the server name for SSH terminals, the local shell label otherwise. */
  serverName: string;
  /** `null` for local terminals. */
  connectionId: string | null;
  settings: TerminalSettings;
  theme: 'dark' | 'light';
  /** Runs before xterm sees a key event; returning `false` swallows it. */
  onKeyEvent?: (session: TerminalSession, event: KeyboardEvent) => boolean;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TerminalSession implements TerminalHandle {
  readonly kind: TerminalKind;
  readonly serverId: string | null;
  readonly serverName: string;
  readonly connectionId: string | null;

  readonly xterm: Terminal;
  readonly element: HTMLElement;
  readonly overlayElement: HTMLElement;
  /** Passed to `term_open` / `term_open_local` as the `onData` extra argument. */
  readonly channel: Channel<ArrayBuffer>;
  readonly search: SearchAddon;

  private _id = '';
  private _disposed = false;
  private readonly screenHost: HTMLElement;
  private readonly fit = new FitAddon();
  private webgl: WebglAddon | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly xtermDisposables: Disposable[] = [];
  private readonly inputEmitter = createEmitter<string>();
  private readonly outputEmitter = createEmitter<Uint8Array>();
  private readonly disposeEmitter = createEmitter<void>();
  private readonly options: TerminalSessionOptions;
  private rightClick: TerminalRightClick;

  private readonly pushResize = debounce((cols: number, rows: number) => {
    if (!this._id || this._disposed) return;
    void call('term_resize', { terminalId: this._id, cols, rows }).catch(() => {
      /* the shell may already be gone; term_close/exit handles the panel state */
    });
  }, 120);

  constructor(options: TerminalSessionOptions) {
    this.options = options;
    this.rightClick = options.settings.rightClick;
    this.kind = options.kind;
    this.serverId = options.serverId;
    this.serverName = options.serverName;
    this.connectionId = options.connectionId;

    this.element = document.createElement('div');
    this.element.className = 'ns-term-root';
    const theme = terminalTheme(options.settings, options.theme);
    // The padding around the screen must match the scheme, not the UI theme.
    this.element.style.background = theme.background ?? '';

    this.screenHost = document.createElement('div');
    this.screenHost.className = 'ns-term-screen';
    this.element.appendChild(this.screenHost);

    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'ns-term-overlay';
    this.element.appendChild(this.overlayElement);

    this.xterm = new Terminal({
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      allowProposedApi: true,
      cursorBlink: options.settings.cursorBlink,
      cursorStyle: options.settings.cursorStyle,
      fontFamily: options.settings.fontFamily,
      fontSize: options.settings.fontSize,
      lineHeight: options.settings.lineHeight,
      scrollback: options.settings.scrollback,
      theme,
      minimumContrastRatio: options.settings.minimumContrastRatio,
      macOptionIsMeta: true,
      scrollOnUserInput: true,
    });

    this.xterm.loadAddon(this.fit);
    const unicode = new Unicode11Addon();
    this.xterm.loadAddon(unicode);
    this.xterm.unicode.activeVersion = '11';
    this.xterm.loadAddon(new WebLinksAddon());
    this.search = new SearchAddon();
    this.xterm.loadAddon(this.search);

    this.xterm.open(this.screenHost);
    this.enableWebgl(options.settings.webgl);

    this.xtermDisposables.push(
      this.xterm.onData((data) => {
        this.inputEmitter.fire(data);
        void this.write(data);
      }),
      this.xterm.onResize(({ cols, rows }) => this.pushResize(cols, rows)),
    );

    this.xterm.attachCustomKeyEventHandler((event) => this.handleKeyEvent(event));
    this.element.addEventListener('contextmenu', this.handleContextMenu);

    this.channel = new Channel<ArrayBuffer>((buffer) => {
      if (this._disposed) return;
      const bytes = new Uint8Array(buffer);
      this.xterm.write(bytes);
      this.outputEmitter.fire(bytes);
    });
  }

  // -- identity ------------------------------------------------------------

  get id(): string {
    return this._id;
  }

  /** Called once `term_open` reported the server-side terminal id. */
  assignId(id: string): void {
    this._id = id;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /** Viewport size to request when opening the PTY. */
  get size(): { cols: number; rows: number } {
    return { cols: this.xterm.cols, rows: this.xterm.rows };
  }

  // -- DOM ownership -------------------------------------------------------

  mount(parent: HTMLElement): void {
    if (this._disposed) return;
    parent.appendChild(this.element);
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.element);
    this.refit();
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.element.remove();
  }

  refit(): void {
    if (this._disposed) return;
    if (this.element.clientWidth === 0 || this.element.clientHeight === 0) return;
    try {
      this.fit.fit();
    } catch (error) {
      console.warn('[navishell] terminal fit failed', error);
    }
  }

  // -- settings ------------------------------------------------------------

  applySettings(settings: TerminalSettings, theme: 'dark' | 'light'): void {
    this.rightClick = settings.rightClick;
    if (this._disposed) return;
    const { options } = this.xterm;
    options.fontFamily = settings.fontFamily;
    options.fontSize = settings.fontSize;
    options.lineHeight = settings.lineHeight;
    options.cursorBlink = settings.cursorBlink;
    options.cursorStyle = settings.cursorStyle;
    options.scrollback = settings.scrollback;
    const palette = terminalTheme(settings, theme);
    options.theme = palette;
    options.minimumContrastRatio = settings.minimumContrastRatio;
    this.element.style.background = palette.background ?? '';
    this.enableWebgl(settings.webgl);
    this.refit();
  }

  private enableWebgl(enabled: boolean): void {
    if (enabled && !this.webgl) {
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          console.warn('[navishell] WebGL context lost, falling back to the DOM renderer');
          addon.dispose();
          if (this.webgl === addon) this.webgl = undefined;
        });
        this.xterm.loadAddon(addon);
        this.webgl = addon;
      } catch (error) {
        console.warn('[navishell] WebGL renderer unavailable, using the DOM renderer', error);
        this.webgl = undefined;
      }
    } else if (!enabled && this.webgl) {
      try {
        this.webgl.dispose();
      } catch {
        /* ignore */
      }
      this.webgl = undefined;
    }
  }

  // -- TerminalHandle ------------------------------------------------------

  async write(data: string): Promise<void> {
    if (this._disposed || !this._id) return;
    try {
      await call('term_write', { terminalId: this._id, data });
    } catch (error) {
      console.warn('[navishell] term_write failed', error);
    }
  }

  onInput(cb: (data: string) => void): Disposable {
    return this.inputEmitter.event(cb);
  }

  onOutput(cb: (data: Uint8Array) => void): Disposable {
    return this.outputEmitter.event(cb);
  }

  onDidDispose(cb: () => void): Disposable {
    return this.disposeEmitter.event(cb);
  }

  focus(): void {
    if (this._disposed) return;
    this.xterm.focus();
  }

  getCursorPixelPosition(): CursorPixelPosition {
    const col = this.xterm.buffer.active.cursorX;
    const row = this.xterm.buffer.active.cursorY;
    const screen = this.xterm.element?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) {
      return { x: 0, y: 0, cellWidth: 0, cellHeight: 0, col, row };
    }
    const screenRect = screen.getBoundingClientRect();
    const hostRect = this.element.getBoundingClientRect();
    const cellWidth = this.xterm.cols > 0 ? screenRect.width / this.xterm.cols : 0;
    const cellHeight = this.xterm.rows > 0 ? screenRect.height / this.xterm.rows : 0;
    return {
      x: screenRect.left - hostRect.left + col * cellWidth,
      y: screenRect.top - hostRect.top + row * cellHeight,
      cellWidth,
      cellHeight,
      col,
      row,
    };
  }

  // -- input handling ------------------------------------------------------

  private handleKeyEvent(event: KeyboardEvent): boolean {
    if (this._disposed) return true;

    if (this.options.onKeyEvent && this.options.onKeyEvent(this, event) === false) {
      return false;
    }
    if (event.type !== 'keydown') return true;

    // Returning `false` only keeps xterm from acting on the key; the browser's own
    // action for the combination still runs unless the event is cancelled. For
    // Ctrl+Shift+V that action is "paste as plain text", which lands in xterm's textarea
    // as a `paste` event - a second copy of what pasteFromClipboard() already sent.
    const key = event.key.toLowerCase();
    if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'c') {
      if (this.xterm.hasSelection()) {
        event.preventDefault();
        void this.copySelection();
        return false;
      }
      return true;
    }
    if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'v') {
      event.preventDefault();
      void this.pasteFromClipboard();
      return false;
    }
    return true;
  }

  /**
   * The right button: with `terminal.rightClick` set to `menu` (or Shift held) nothing
   * happens here and the panel opens the context menu; otherwise the click copies the
   * selection or pastes, PuTTY style, or always pastes.
   */
  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (this._disposed) return;
    // Let plugin overlays own their own context menus.
    if (this.overlayElement.contains(event.target as Node)) return;
    const mode = event.shiftKey ? 'menu' : this.rightClick;
    if (mode === 'menu') return;
    event.preventDefault();
    if (mode === 'copyPaste' && this.xterm.hasSelection()) {
      void this.copySelection();
      this.xterm.clearSelection();
      return;
    }
    void this.pasteFromClipboard();
  };

  async copySelection(): Promise<void> {
    const selection = this.xterm.getSelection();
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection);
    } catch (error) {
      console.warn('[navishell] clipboard write failed', error);
    }
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.xterm.paste(text);
    } catch (error) {
      console.warn('[navishell] clipboard read failed', error);
    }
  }

  // -- lifecycle -----------------------------------------------------------

  /** Write a dim status line into the scrollback (used when the shell exits). */
  writeNotice(text: string): void {
    if (this._disposed) return;
    this.xterm.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.pushResize.cancel();
    this.element.removeEventListener('contextmenu', this.handleContextMenu);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    for (const disposable of this.xtermDisposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        /* ignore */
      }
    }
    try {
      this.webgl?.dispose();
    } catch {
      /* ignore */
    }
    this.webgl = undefined;
    try {
      this.xterm.dispose();
    } catch (error) {
      console.warn('[navishell] xterm dispose failed', error);
    }
    this.element.remove();
    this.disposeEmitter.fire();
    this.inputEmitter.clear();
    this.outputEmitter.clear();
    this.disposeEmitter.clear();
  }
}
