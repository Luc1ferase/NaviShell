/**
 * @navishell/plugin-api
 *
 * The public contract between NaviShell (the host) and plugins.
 *
 * A plugin is a directory containing `plugin.json` (a {@link PluginManifest}) and a
 * CommonJS bundle (default `main.js`). The host evaluates the bundle with an injected
 * `require` that resolves ONLY these shared modules (do not bundle them yourself):
 *
 *   - "react", "react/jsx-runtime", "react-dom", "react-dom/client"
 *   - "@navishell/plugin-api"
 *   - "lucide-react"
 *
 * Everything else must be bundled into the plugin. `module.exports` (or
 * `module.exports.default`) must be a {@link NaviShellPlugin} object.
 *
 * Built-in plugins (SFTP file manager, command completion) ship with the app but use
 * exactly this API; third-party plugins are loaded from `<appData>/plugins/<id>/`.
 */

import type { ComponentType } from 'react';
import type { Terminal } from '@xterm/xterm';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void;
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * A UI language tag (BCP 47, e.g. `en`, `zh-CN`, `ja`). `en` and `zh-CN` are built into the
 * host; language-pack plugins add more through {@link I18nApi.registerLocale}.
 */
export type Locale = string;

/** The locales the host ships strings for itself. */
export type BuiltinLocale = 'en' | 'zh-CN';

/** Either a plain string or a per-locale map; the host picks the current locale. */
export type LocalizedText = string | Partial<Record<Locale, string>>;

/**
 * A UI language contributed by a plugin (the VS Code language-pack model): strings for
 * the host and, keyed by plugin id, for any other plugins. Registering it makes the locale
 * selectable in Settings; disposing the registration removes it again.
 */
export interface LocalePack {
  /** Locale tag, e.g. `ja` or `zh-TW`. A built-in id only adds strings to that locale. */
  id: Locale;
  /** Native display name shown in the language menu, e.g. `日本語`. */
  name: string;
  /**
   * Lower-case OS language tags (or prefixes of them) that select this pack when the app
   * follows the system language, e.g. `['zh-tw', 'zh-hk', 'zh-hant']`. Defaults to `[id]`.
   */
  matches?: string[];
  /** Locale to try before `en` when a string is missing, e.g. `zh-CN` for `zh-TW`. */
  fallback?: Locale;
  /** Host UI strings; same (nested) shape as the host's `en.json`. */
  host?: Record<string, unknown>;
  /** Strings for other plugins, keyed by plugin id, in each plugin's own key space. */
  plugins?: Record<string, Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Manifest & plugin entry
// ---------------------------------------------------------------------------

export interface PluginManifest {
  /** Unique id, lowercase, dot/kebab separated. Built-ins use `navishell.<name>`. */
  id: string;
  name: LocalizedText;
  version: string;
  description?: LocalizedText;
  author?: string;
  homepage?: string;
  /** Path (relative to the plugin dir) of the CommonJS bundle. Default: "main.js". */
  main?: string;
  /** CSS files (relative to the plugin dir) injected into the document when the plugin activates. */
  styles?: string[];
  /** lucide-react icon name used where the host needs an icon for the plugin. */
  icon?: string;
  /** Minimum host (app) version this plugin supports, e.g. "0.1.0". */
  minHostVersion?: string;
}

export interface NaviShellPlugin {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** Identity helper so plugin authors get type checking on their export. */
export function definePlugin(plugin: NaviShellPlugin): NaviShellPlugin {
  return plugin;
}

// ---------------------------------------------------------------------------
// Core data types (shared with the Rust side; field names are camelCase on the wire)
// ---------------------------------------------------------------------------

/**
 * How to authenticate.
 * - `password`: stored in the OS keychain (account `<serverId>`) or prompted.
 * - `key`: OpenSSH private key file; an encrypted key's passphrase is stored under
 *   keychain account `<serverId>:passphrase` or prompted.
 * - `agent`: ssh-agent (Windows OpenSSH agent named pipe, `SSH_AUTH_SOCK` elsewhere).
 * Keyboard-interactive (OTP / 2FA) is not a method of its own: the host falls back to it
 * automatically when the server requires it and asks the user through a prompt dialog.
 */
export type AuthMethod =
  { type: 'password' } | { type: 'key'; keyPath: string } | { type: 'agent' };

export type AuthMethodType = AuthMethod['type'];

export interface ServerRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** Optional folder/group name used to group servers in the sidebar. */
  group?: string;
  tags?: string[];
  /** Optional accent colour (CSS colour string). */
  color?: string;
  auth: AuthMethod;
  /** Connect through this saved server first (ProxyJump). `null`/absent = direct. */
  jumpServerId?: string | null;
  /** Unix epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/** Payload accepted by `servers_save`; `id` omitted => create. */
export type ServerInput = Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export type HostKeyStatus = 'known' | 'new';

export interface ConnectionInfo {
  id: string;
  serverId: string;
  host: string;
  port: number;
  username: string;
  /** Unix epoch milliseconds. */
  connectedAt: number;
  /** e.g. "SHA256:abc..." */
  hostKeyFingerprint: string;
  hostKeyStatus: HostKeyStatus;
  /** The auth method that succeeded. */
  authMethod: AuthMethodType;
  /** Set when the session is tunnelled through another connection (ProxyJump). */
  viaConnectionId: string | null;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** `null` when the remote did not report an exit status. */
  exitCode: number | null;
}

export type SftpEntryKind = 'file' | 'dir' | 'symlink' | 'other';

export interface SftpEntry {
  name: string;
  /** Absolute remote path. */
  path: string;
  kind: SftpEntryKind;
  /** Bytes; `null` when unknown. */
  size: number | null;
  /** Unix epoch seconds; `null` when unknown. */
  mtime: number | null;
  /** POSIX mode bits (e.g. 0o644); `null` when unknown. */
  permissions: number | null;
  uid: number | null;
  gid: number | null;
  owner: string | null;
  group: string | null;
}

export interface TransferProgress {
  transferId: string;
  /** Bytes transferred so far. */
  transferred: number;
  /** Total bytes, or `null` if unknown. */
  total: number | null;
}

export interface TransferHandle {
  readonly transferId: string;
  /** Resolves when the transfer finishes; rejects on error or cancellation. */
  readonly done: Promise<void>;
  cancel(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type HostErrorCode =
  | 'PasswordRequired'
  /** The private key is encrypted and no passphrase was given or stored. */
  | 'PassphraseRequired'
  /** No ssh-agent could be reached (or it holds no usable identity). */
  | 'AgentUnavailable'
  | 'AuthFailed'
  | 'HostKeyMismatch'
  | 'ConnectFailed'
  | 'NotConnected'
  | 'NotFound'
  | 'Io'
  | 'Sftp'
  | 'Keyring'
  | 'Cancelled'
  | 'Timeout'
  | 'InvalidArgument'
  | 'Internal';

/** Shape of every error rejected by host commands (Rust `AppError` serialised). */
export interface HostError {
  code: HostErrorCode;
  message: string;
  /** Extra data, e.g. for HostKeyMismatch: { fingerprint, expectedFingerprint }. */
  data?: Record<string, JsonValue>;
}

export function isHostError(e: unknown): e is HostError {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as HostError).code === 'string' &&
    typeof (e as HostError).message === 'string'
  );
}

// ---------------------------------------------------------------------------
// Panels (dockable views)
// ---------------------------------------------------------------------------

export type PanelPosition = 'left' | 'right' | 'bottom' | 'center';

export interface PanelApi {
  readonly id: string;
  readonly isActive: boolean;
  readonly isVisible: boolean;
  readonly width: number;
  readonly height: number;
  onDidActiveChange(cb: (active: boolean) => void): Disposable;
  onDidVisibilityChange(cb: (visible: boolean) => void): Disposable;
  onDidDimensionsChange(cb: (size: { width: number; height: number }) => void): Disposable;
  setTitle(title: string): void;
  close(): void;
  focus(): void;
}

export interface PanelProps {
  /** Full panel id (`<pluginId>:<panelId>`). */
  panelId: string;
  ctx: PluginContext;
  api: PanelApi;
}

export interface PanelDefinition {
  /** Unique within the plugin. The host namespaces it as `<pluginId>:<id>`. */
  id: string;
  /** i18n key resolved in the plugin's namespace; falls back to the literal string. */
  title: string;
  /** lucide-react icon name. */
  icon?: string;
  component: ComponentType<PanelProps>;
  /** Where the panel is placed the first time it is opened. Default: 'right'. */
  defaultPosition?: PanelPosition;
  /** Open automatically the first time the plugin is activated. Default: false. */
  defaultOpen?: boolean;
  /** Initial size in pixels along the docking axis (width for left/right, height for bottom). */
  defaultSize?: number;
  /** Whether the user can close the panel from its tab. Default: true. */
  closable?: boolean;
}

export interface PanelsApi {
  register(def: PanelDefinition): Disposable;
  /** Open (or reveal and focus) a registered panel by its plugin-local id. */
  open(id: string): void;
  close(id: string): void;
  isOpen(id: string): boolean;
  toggle(id: string): void;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandDefinition {
  /** Unique within the plugin; namespaced by the host as `<pluginId>:<id>`. */
  id: string;
  /** i18n key (plugin namespace) or literal. Shown in the host's command list / menus. */
  title: string;
  icon?: string;
  handler: (...args: unknown[]) => unknown | Promise<unknown>;
}

export interface CommandsApi {
  register(def: CommandDefinition): Disposable;
  /** Execute any command by full id (`<pluginId>:<id>` or a host command like `host:openSettings`). */
  execute<T = unknown>(fullId: string, ...args: unknown[]): Promise<T>;
}

// ---------------------------------------------------------------------------
// Servers & connections
// ---------------------------------------------------------------------------

export interface ServersApi {
  list(): ServerRecord[];
  get(id: string): ServerRecord | undefined;
  onDidChange(cb: (servers: ServerRecord[]) => void): Disposable;
  /**
   * Connect to a server using the host's full flow (keychain lookup, password prompt,
   * host-key confirmation). Returns the existing connection if one is already open.
   */
  connect(serverId: string): Promise<ConnectionInfo>;
  /** Open a new terminal tab for the server (connecting first if needed). */
  openTerminal(serverId: string): Promise<TerminalHandle>;
}

export interface SftpClient {
  readonly connectionId: string;
  home(): Promise<string>;
  list(path: string): Promise<SftpEntry[]>;
  stat(path: string): Promise<SftpEntry>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  readText(path: string, options?: { maxBytes?: number }): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  download(
    remotePath: string,
    localPath: string,
    onProgress?: (p: TransferProgress) => void,
  ): TransferHandle;
  upload(
    localPath: string,
    remotePath: string,
    onProgress?: (p: TransferProgress) => void,
  ): TransferHandle;
}

export interface ConnectionsApi {
  list(): ConnectionInfo[];
  get(id: string): ConnectionInfo | undefined;
  onDidChange(cb: (connections: ConnectionInfo[]) => void): Disposable;
  /** Run a one-shot command on a separate exec channel (does not touch any terminal). */
  exec(
    connectionId: string,
    command: string,
    options?: { timeoutMs?: number },
  ): Promise<ExecResult>;
  /** Lazily opens an SFTP session on the connection and returns a client bound to it. */
  sftp(connectionId: string): SftpClient;
  disconnect(connectionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

export interface CursorPixelPosition {
  /** Pixel position of the cursor cell's top-left corner relative to {@link TerminalHandle.element}. */
  x: number;
  y: number;
  cellWidth: number;
  cellHeight: number;
  /** Cursor column / row within the viewport. */
  col: number;
  row: number;
}

export type TerminalKind = 'ssh' | 'local';

export interface TerminalHandle {
  readonly id: string;
  /** `ssh` terminals belong to a connection; `local` ones run a shell on this machine. */
  readonly kind: TerminalKind;
  /** `null` for local terminals. */
  readonly serverId: string | null;
  /** `null` for local terminals. */
  readonly connectionId: string | null;
  /** The xterm.js instance (read-only use recommended; do not dispose it). */
  readonly xterm: Terminal;
  /** Container element of the terminal panel (position: relative). */
  readonly element: HTMLElement;
  /** Overlay layer above the terminal (absolute, full size, pointer-events: none). */
  readonly overlayElement: HTMLElement;
  readonly isDisposed: boolean;
  /** Send input to the remote shell exactly as if the user typed it. */
  write(data: string): Promise<void>;
  /** Fires for user input (xterm `onData`) BEFORE it is sent to the remote. */
  onInput(cb: (data: string) => void): Disposable;
  /** Fires for remote output after it has been written to xterm. */
  onOutput(cb: (data: Uint8Array) => void): Disposable;
  onDidDispose(cb: () => void): Disposable;
  getCursorPixelPosition(): CursorPixelPosition;
  focus(): void;
}

export interface TerminalOverlayProps {
  terminal: TerminalHandle;
  ctx: PluginContext;
}

export interface TerminalsApi {
  list(): TerminalHandle[];
  getActive(): TerminalHandle | undefined;
  /** Open a new local shell terminal tab (program/args from the host settings). */
  openLocal(options?: { cwd?: string }): Promise<TerminalHandle>;
  onDidOpen(cb: (terminal: TerminalHandle) => void): Disposable;
  onDidClose(cb: (terminal: TerminalHandle) => void): Disposable;
  onDidChangeActive(cb: (terminal: TerminalHandle | undefined) => void): Disposable;
  /**
   * Register a React component rendered inside every terminal's overlay layer
   * (useful for popups such as completion menus).
   */
  registerOverlay(component: ComponentType<TerminalOverlayProps>): Disposable;
  /**
   * Intercept keyboard events on every terminal before xterm handles them.
   * Return `false` to swallow the event (xterm will not see it).
   */
  registerKeyHandler(
    handler: (terminal: TerminalHandle, event: KeyboardEvent) => boolean,
  ): Disposable;
}

// ---------------------------------------------------------------------------
// The local machine
// ---------------------------------------------------------------------------

export type Platform = 'windows' | 'macos' | 'linux' | 'other';

export interface LocalExecOptions {
  /** Default 30 000 ms; the process is killed when it expires. */
  timeoutMs?: number;
  /** Working directory; defaults to the app's. */
  cwd?: string;
}

/** The machine NaviShell itself runs on, as opposed to the SSH connections. */
export interface LocalApi {
  readonly platform: Platform;
  /** e.g. `x86_64`, `aarch64`. */
  readonly arch: string;
  /**
   * Run a program on this machine without a shell and collect what it printed. `program`
   * is resolved through `PATH`; pass a shell explicitly (`sh -c …`,
   * `powershell -Command …`) when shell syntax is needed. No window is shown on Windows.
   * Output is decoded as UTF-8 and capped at 8 MiB per stream.
   */
  exec(program: string, args?: string[], options?: LocalExecOptions): Promise<ExecResult>;
}

// ---------------------------------------------------------------------------
// Storage, i18n, UI, logging
// ---------------------------------------------------------------------------

/** Per-plugin persistent key/value storage backed by `<appData>/plugin-data/<pluginId>.json`. */
export interface StorageApi {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  get<T extends JsonValue = JsonValue>(key: string, fallback: T): Promise<T>;
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface I18nApi {
  /** Current locale. */
  readonly locale: Locale;
  /** Register translations under the plugin's namespace. */
  addResources(locale: Locale, resources: Record<string, string>): void;
  /** Translate a key from the plugin's namespace; falls back to the key itself. */
  t(key: string, options?: Record<string, unknown>): string;
  onDidChangeLocale(cb: (locale: Locale) => void): Disposable;
  /** Contribute a whole UI language (see {@link LocalePack}); dispose to remove it. */
  registerLocale(pack: LocalePack): Disposable;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ConfirmOptions {
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Style the OK button as destructive. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  password?: boolean;
  okLabel?: string;
  cancelLabel?: string;
}

export interface FilePickerOptions {
  title?: string;
  multiple?: boolean;
  directory?: boolean;
  defaultPath?: string;
}

export interface MenuItem {
  id?: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Shows a check mark on the right, for toggles and "currently open" states. */
  checked?: boolean;
  /** `true` renders a separator; other fields are ignored. */
  separator?: boolean;
  /**
   * Shortcut hint shown on the right, e.g. `Ctrl+Shift+C`. Display only: the host does
   * not bind it, the item is reachable by the key only when something else handles it.
   */
  shortcut?: string;
  /** Nested items, opened as a submenu; `onClick` is ignored when this is set. */
  submenu?: MenuItem[];
  onClick?: () => void;
}

export interface UiApi {
  toast(message: string, kind?: ToastKind): void;
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  /** Native open-file dialog. Resolves to selected paths or `null` when cancelled. */
  pickFiles(options?: FilePickerOptions): Promise<string[] | null>;
  /** Native save-file dialog. */
  pickSaveFile(options?: { title?: string; defaultPath?: string }): Promise<string | null>;
  /** Reveal a local file/folder in the OS file manager. */
  revealPath(path: string): Promise<void>;
  /** Show a context menu at viewport coordinates. */
  showContextMenu(items: MenuItem[], position: { x: number; y: number }): void;
}

// ---------------------------------------------------------------------------
// Menu contributions
// ---------------------------------------------------------------------------

/** The host context menus a plugin can add items to. */
export type MenuId = 'terminal' | 'server' | 'tab';

/** What a `terminal` menu provider learns about the terminal the menu was opened on. */
export interface TerminalMenuContext {
  terminal: TerminalHandle;
  /** The selected text at the time the menu opened; empty when nothing is selected. */
  selection: string;
}

/** What a `server` menu provider learns about the server row the menu was opened on. */
export interface ServerMenuContext {
  server: ServerRecord;
}

/** What a `tab` menu provider learns about the dock tab the menu was opened on. */
export interface TabMenuContext {
  /** The dock panel id: `terminal:<terminalId>` for terminals, the panel's full id otherwise. */
  panelId: string;
  title: string;
  /** Set when the tab holds a terminal. */
  terminal?: TerminalHandle;
}

export interface MenuContexts {
  terminal: TerminalMenuContext;
  server: ServerMenuContext;
  tab: TabMenuContext;
}

export interface MenusApi {
  /**
   * Contribute items to one of the host's context menus. The provider runs every time
   * that menu opens and returns the items to append (an empty array adds nothing); the
   * host groups each plugin's items behind a separator.
   */
  register<K extends MenuId>(
    menu: K,
    provider: (context: MenuContexts[K]) => MenuItem[],
  ): Disposable;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// File icon themes
// ---------------------------------------------------------------------------

/** What a file icon theme is asked about: one entry of a directory listing. */
export interface FileIconRequest {
  /** The entry's name, e.g. `package.json`. */
  name: string;
  kind: SftpEntryKind;
  /** Lower-case extension without the dot (`archive.tar.gz` → `gz`); `''` when there is none. */
  extension: string;
}

/**
 * An icon as a theme hands it out: SVG markup, or an image URL (`data:` or `https:`). The
 * host draws it as an `<img>` at the row's icon size, so scripts and styles in the markup
 * never run and the icon cannot affect the page around it.
 */
export type FileIcon = { svg: string } | { url: string };

/** A set of file and folder icons for the file manager, like VS Code's file icon themes. */
export interface FileIconTheme {
  /** Unique within the plugin; the host refers to the theme as `<pluginId>:<id>`. */
  id: string;
  /** Shown under Settings → Appearance → File icons. */
  label: LocalizedText;
  /**
   * The icon for an entry, or `undefined` to let the host draw its own default for it.
   * Called for every visible row, so keep it a lookup.
   */
  icon(request: FileIconRequest): FileIcon | undefined;
}

export interface FileIconsApi {
  /**
   * Contribute a theme. It appears in the File icons setting; the user picks it there, or
   * the plugin calls {@link activate} once (say, on its first run).
   */
  registerTheme(theme: FileIconTheme): Disposable;
  /** Make one of this plugin's themes the active one (`<id>` as passed to `registerTheme`). */
  activate(id: string): void;
  /** The active theme's icon for an entry; `undefined` when no theme is active or it has none. */
  resolve(request: FileIconRequest): FileIcon | undefined;
  /** Fires when the active theme changes: picked in Settings, registered, or gone. */
  onDidChangeTheme(cb: () => void): Disposable;
}

// ---------------------------------------------------------------------------
// Plugin context
// ---------------------------------------------------------------------------

export interface PluginContext {
  readonly id: string;
  readonly manifest: PluginManifest;
  readonly hostVersion: string;
  /** Absolute path of the plugin directory (built-ins: a virtual `builtin://<id>` URL). */
  readonly pluginDir: string;
  /** Disposables pushed here are disposed automatically on deactivate. */
  readonly subscriptions: Disposable[];
  readonly panels: PanelsApi;
  readonly commands: CommandsApi;
  readonly servers: ServersApi;
  readonly connections: ConnectionsApi;
  readonly terminals: TerminalsApi;
  readonly local: LocalApi;
  readonly storage: StorageApi;
  readonly i18n: I18nApi;
  readonly ui: UiApi;
  readonly menus: MenusApi;
  readonly fileIcons: FileIconsApi;
  readonly log: Logger;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function toDisposable(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (!done) {
        done = true;
        fn();
      }
    },
  };
}

export function disposeAll(items: Disposable[]): void {
  for (const d of items.splice(0)) {
    try {
      d.dispose();
    } catch (e) {
      console.error('dispose failed', e);
    }
  }
}

/**
 * Pick the text for `locale`, then each of `fallbacks` in order, then `en`, then whatever
 * is there.
 */
export function resolveLocalized(
  text: LocalizedText | undefined,
  locale: Locale,
  fallbacks: readonly Locale[] = [],
): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  for (const candidate of [locale, ...fallbacks, 'en']) {
    const value = text[candidate];
    if (value) return value;
  }
  return Object.values(text).find((value) => value) ?? '';
}
