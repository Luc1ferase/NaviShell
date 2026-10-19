/**
 * Host <-> Rust IPC contract.
 *
 * This file is the single source of truth for Tauri command names, their arguments and
 * return types. The Rust side (`src-tauri/src/**`) MUST implement exactly these commands.
 *
 * Conventions
 * - Commands are `snake_case`; arguments are passed as a flat object with camelCase keys
 *   (Tauri converts `server_id` <-> `serverId` automatically with the default settings).
 * - Every command returns `Result<T, AppError>`; `AppError` serialises to {@link HostError}
 *   (`{ code, message, data? }`), so `invoke` rejects with that object.
 * - Binary terminal output is streamed through a `tauri::ipc::Channel<tauri::ipc::Response>`
 *   built with `Response::new(bytes)`, which the JS side receives as `ArrayBuffer`.
 * - Progress/JSON streams use `Channel<T>` with a serialisable T.
 * - App-wide notifications use Tauri events (`app.emit`), listed in {@link HostEvents}.
 */

import type {
  ConnectionInfo,
  ExecResult,
  HostError,
  JsonValue,
  LocalizedText,
  PluginManifest,
  ServerInput,
  ServerRecord,
  SftpEntry,
} from '@navishell/plugin-api';

export type { HostError };
export type { TransferProgress } from '@navishell/plugin-api';

// ---------------------------------------------------------------------------
// Settings & layout (stored as JSON files in the app data dir)
// ---------------------------------------------------------------------------

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorBlink: boolean;
  cursorStyle: 'block' | 'underline' | 'bar';
  scrollback: number;
  /** Prefer the WebGL renderer when available. */
  webgl: boolean;
  /** Value sent as TERM, e.g. "xterm-256color". */
  termType: string;
}

export interface LocalShellSettings {
  /**
   * Program to launch for local terminals. `null` = auto-detect
   * (Windows: `pwsh.exe` if present else `powershell.exe`; elsewhere `$SHELL` else `/bin/bash`).
   */
  program: string | null;
  args: string[];
}

export interface AppSettings {
  /** "system" follows the OS locale. */
  locale: 'system' | 'en' | 'zh-CN';
  theme: 'dark' | 'light' | 'system';
  terminal: TerminalSettings;
  localShell: LocalShellSettings;
  updates: {
    /** Check GitHub Releases for a newer version once after startup. */
    checkOnStartup: boolean;
  };
  plugins: {
    /** Plugin ids the user disabled. */
    disabled: string[];
    /** Registry index URL for the marketplace list; `null` = {@link DEFAULT_PLUGIN_REGISTRY_URL}. */
    registryUrl: string | null;
    /** Panel ids (`<pluginId>:<panelId>`) that have been auto-opened once (for `defaultOpen`). */
    seenPanels: string[];
  };
  /** Auto-close the SSH connection when its last terminal closes. */
  closeConnectionWithLastTerminal: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  locale: 'system',
  theme: 'dark',
  terminal: {
    fontFamily: '"Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 5000,
    webgl: true,
    termType: 'xterm-256color',
  },
  localShell: { program: null, args: [] },
  updates: { checkOnStartup: true },
  plugins: { disabled: [], registryUrl: null, seenPanels: [] },
  closeConnectionWithLastTerminal: true,
};

export type CredentialKind = 'password' | 'passphrase';

export interface AppPaths {
  appData: string;
  pluginsDir: string;
  pluginDataDir: string;
  logsDir: string;
}

export interface AppInfo {
  version: string;
  platform: 'windows' | 'macos' | 'linux' | 'other';
  arch: string;
  paths: AppPaths;
}

// ---------------------------------------------------------------------------
// External plugins
// ---------------------------------------------------------------------------

/**
 * One entry of a plugin registry index (the "marketplace"). The index is a plain JSON
 * document, see `registry/plugins.json` in this repository for the canonical one.
 */
export interface PluginRegistryEntry {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  version: string;
  /** Direct http(s) URL of the plugin zip, installable with `plugins_install_from_url`. */
  url: string;
  /** Hex SHA-256 of the zip; strongly recommended. */
  sha256?: string;
  homepage?: string;
  author?: string;
  minHostVersion?: string;
  /** lucide-react icon name. */
  icon?: string;
}

export interface PluginRegistry {
  name?: string;
  /** ISO date of the last index update. */
  updatedAt?: string;
  plugins: PluginRegistryEntry[];
}

export const DEFAULT_PLUGIN_REGISTRY_URL =
  'https://raw.githubusercontent.com/Luc1ferase/NaviShell/master/registry/plugins.json';

export interface ExternalPluginInfo {
  manifest: PluginManifest;
  /** Absolute directory path. */
  dir: string;
  /** Set when the manifest could not be parsed; `manifest` is then a best-effort stub. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Command table
// ---------------------------------------------------------------------------

/**
 * Map of command name -> { args, result }. Channels are passed as extra args by the
 * client wrapper and are documented in comments.
 */
export interface Commands {
  // ---- app ---------------------------------------------------------------
  /** Version, platform and data directories. */
  app_info: { args: Record<string, never>; result: AppInfo };

  // ---- settings & layout -------------------------------------------------
  settings_get: { args: Record<string, never>; result: AppSettings };
  settings_set: { args: { settings: AppSettings }; result: void };
  /** Serialised dockview layout; `null` when none saved. */
  layout_get: { args: Record<string, never>; result: JsonValue | null };
  layout_set: { args: { layout: JsonValue }; result: void };

  // ---- servers -----------------------------------------------------------
  servers_list: { args: Record<string, never>; result: ServerRecord[] };
  /** Upsert. Generates `id`/`createdAt` when missing; always refreshes `updatedAt`. */
  servers_save: { args: { server: ServerInput }; result: ServerRecord };
  /** Also deletes the stored credential (ignores a missing one). */
  servers_delete: { args: { serverId: string }; result: void };

  // ---- credentials (OS keychain; service "dev.navishell") ---------------
  /**
   * `kind` selects the keychain account: `password` => `<serverId>`,
   * `passphrase` (private-key passphrase) => `<serverId>:passphrase`. Default: `password`.
   */
  credential_exists: { args: { serverId: string; kind?: CredentialKind }; result: boolean };
  credential_set: {
    args: { serverId: string; password: string; kind?: CredentialKind };
    result: void;
  };
  credential_delete: { args: { serverId: string; kind?: CredentialKind }; result: void };

  // ---- ssh connections ---------------------------------------------------
  /**
   * Connect and authenticate according to the server's `auth` method.
   * - Host keys: unknown host => trust on first use, store, `hostKeyStatus: 'new'`.
   *   Mismatch => reject `HostKeyMismatch` with `data: { fingerprint, expectedFingerprint }`
   *   unless `trustHostKey` is true (then replace the stored key).
   * - `password` auth: `password` omitted => use the keychain; none stored => reject
   *   `PasswordRequired`. `savePassword` => store after a successful auth.
   * - `key` auth: load `auth.keyPath`; if the key is encrypted use `passphrase`, else the
   *   keychain (`<serverId>:passphrase`), else reject `PassphraseRequired`.
   *   `savePassphrase` => store after success. Unreadable/unsupported key => `AuthFailed`
   *   with a descriptive message.
   * - `agent` auth: talk to the ssh-agent; no agent / no identity accepted =>
   *   `AgentUnavailable` (unreachable) or `AuthFailed` (reachable but rejected).
   * - Keyboard-interactive fallback: when the chosen method is rejected or not offered and
   *   the server offers `keyboard-interactive`, start it. For each info request emit the
   *   `auth:prompt` event and wait (max 180 s) for `ssh_auth_respond` with the same
   *   `requestId`. A single hidden prompt whose text contains "password" is answered
   *   automatically with the available password (keychain or arg) once before asking.
   * - ProxyJump: pass `viaConnectionId` (an OPEN connection to the jump host, obtained by
   *   connecting to `jumpServerId` first). The session is tunnelled through a
   *   direct-tcpip channel of that connection; `ConnectionInfo.viaConnectionId` records it.
   *   When the jump connection closes, tunnelled connections close too.
   * - Wrong credentials => `AuthFailed`. Network/DNS/timeout => `ConnectFailed` / `Timeout`.
   */
  ssh_connect: {
    args: {
      serverId: string;
      password?: string;
      savePassword?: boolean;
      passphrase?: string;
      savePassphrase?: boolean;
      trustHostKey?: boolean;
      viaConnectionId?: string;
    };
    result: ConnectionInfo;
  };
  /**
   * Answers (or cancels, with `responses: null`) a pending `auth:prompt`. Unknown or
   * expired `requestId` => `NotFound`.
   */
  ssh_auth_respond: { args: { requestId: string; responses: string[] | null }; result: void };
  ssh_disconnect: { args: { connectionId: string }; result: void };
  ssh_list_connections: { args: Record<string, never>; result: ConnectionInfo[] };
  /** One-shot command on a fresh exec channel; default timeout 30s. */
  ssh_exec: {
    args: { connectionId: string; command: string; timeoutMs?: number };
    result: ExecResult;
  };

  // ---- terminals (PTY shell channels) ------------------------------------
  /**
   * Extra arg `onData: Channel<ArrayBuffer>` receives raw remote output.
   * Exit/close is reported with the `terminal:exit` event.
   */
  term_open: {
    args: { connectionId: string; cols: number; rows: number; term: string };
    result: { terminalId: string };
  };
  /**
   * Local shell terminal (portable-pty). Same `onData: Channel<ArrayBuffer>` extra arg and
   * the same `term_write` / `term_resize` / `term_close` commands and `terminal:exit` event
   * as SSH terminals. `program`/`args` default to `settings.localShell` resolution; `cwd`
   * defaults to the home directory. Environment gets `TERM=<term>` and `COLORTERM=truecolor`.
   */
  term_open_local: {
    args: {
      cols: number;
      rows: number;
      term: string;
      program?: string | null;
      args?: string[];
      cwd?: string | null;
    };
    result: { terminalId: string };
  };
  /** `data` is UTF-8 text written to the channel as bytes. */
  term_write: { args: { terminalId: string; data: string }; result: void };
  term_resize: { args: { terminalId: string; cols: number; rows: number }; result: void };
  term_close: { args: { terminalId: string }; result: void };

  // ---- sftp (one lazily-opened SFTP session per connection) --------------
  /** Canonical home directory (`realpath "."`). */
  sftp_home: { args: { connectionId: string }; result: string };
  /** Entries sorted by the caller; `.` and `..` are excluded. */
  sftp_list: { args: { connectionId: string; path: string }; result: SftpEntry[] };
  sftp_stat: { args: { connectionId: string; path: string }; result: SftpEntry };
  sftp_mkdir: { args: { connectionId: string; path: string }; result: void };
  sftp_rename: { args: { connectionId: string; from: string; to: string }; result: void };
  /** Directories require `recursive: true` unless empty. */
  sftp_remove: { args: { connectionId: string; path: string; recursive?: boolean }; result: void };
  /** Rejects `InvalidArgument` if the file is larger than `maxBytes` (default 2 MiB). */
  sftp_read_text: {
    args: { connectionId: string; path: string; maxBytes?: number };
    result: string;
  };
  sftp_write_text: { args: { connectionId: string; path: string; content: string }; result: void };
  /**
   * Extra arg `onProgress: Channel<TransferProgress>`. Resolves when complete.
   * `transferId` is generated by the caller (uuid) so it can cancel mid-flight.
   */
  sftp_download: {
    args: { connectionId: string; remotePath: string; localPath: string; transferId: string };
    result: void;
  };
  sftp_upload: {
    args: { connectionId: string; localPath: string; remotePath: string; transferId: string };
    result: void;
  };
  /** Cancels a running transfer; the transfer command then rejects with `Cancelled`. */
  sftp_cancel: { args: { transferId: string }; result: void };

  // ---- plugins -----------------------------------------------------------
  /** Scans `<appData>/plugins/<id>/plugin.json` for every subdirectory (creating the dir if needed). */
  plugins_list_external: { args: Record<string, never>; result: ExternalPluginInfo[] };
  /** Reads a UTF-8 file inside an external plugin dir; rejects paths escaping the dir. */
  plugins_read_file: { args: { pluginId: string; relPath: string }; result: string };
  /**
   * Installs an external plugin from a zip archive at an http(s) URL (issue #7).
   * - Downloads to a temp file (max 50 MiB, 60 s), verifies `sha256` (hex) when given
   *   (`InvalidArgument` on mismatch), unpacks it rejecting absolute paths / `..`.
   * - The archive must contain `plugin.json` at its root or inside a single top-level
   *   directory; its `id` must match `^[a-z0-9][a-z0-9._-]*$` and must not be a built-in
   *   (`navishell.*`) id. Installed into `<pluginsDir>/<id>/`.
   * - An existing plugin with the same id is replaced only when `replace` is true,
   *   otherwise `InvalidArgument` with `data: { exists: true, version }`.
   * Network/HTTP failures => `Io` with the status/message. Nothing is loaded; the host
   * reloads plugins afterwards.
   */
  plugins_install_from_url: {
    args: { url: string; sha256?: string; replace?: boolean };
    result: ExternalPluginInfo;
  };
  /** Same as `plugins_install_from_url` but from a local zip file path. */
  plugins_install_from_file: {
    args: { path: string; replace?: boolean };
    result: ExternalPluginInfo;
  };
  /** Deletes `<pluginsDir>/<id>/` (external plugins only; `NotFound` otherwise). */
  plugins_uninstall: { args: { pluginId: string }; result: void };
  /**
   * Downloads and validates a registry index (`url` defaults to
   * {@link DEFAULT_PLUGIN_REGISTRY_URL}; http(s) only, 15 s timeout, 1 MiB cap).
   * Entries with an invalid `id` (same rule as installs), a non-http(s) `url` or a missing
   * `version` are dropped, not fatal. Network/HTTP/parse failures => `Io`.
   */
  plugins_fetch_registry: { args: { url?: string }; result: PluginRegistry };
  plugin_storage_get: { args: { pluginId: string; key: string }; result: JsonValue | null };
  plugin_storage_set: { args: { pluginId: string; key: string; value: JsonValue }; result: void };
  plugin_storage_remove: { args: { pluginId: string; key: string }; result: void };
}

export type CommandName = keyof Commands;
export type CommandArgs<K extends CommandName> = Commands[K]['args'];
export type CommandResult<K extends CommandName> = Commands[K]['result'];

// ---------------------------------------------------------------------------
// Events (Rust -> frontend, via `app.emit(name, payload)`)
// ---------------------------------------------------------------------------

export interface AuthPromptItem {
  prompt: string;
  /** `false` => hide the input (password-like). */
  echo: boolean;
}

export interface HostEvents {
  /** The SSH session ended (remote closed, network error, or `ssh_disconnect`). */
  'connection:closed': { connectionId: string; reason: string | null };
  /** The shell channel (or local shell) ended. Emitted exactly once per terminal. */
  'terminal:exit': { terminalId: string; exitCode: number | null };
  /**
   * Keyboard-interactive request during `ssh_connect`. The frontend shows the prompts and
   * answers with `ssh_auth_respond`. `name`/`instructions` may be empty strings.
   */
  'auth:prompt': {
    requestId: string;
    serverId: string;
    name: string;
    instructions: string;
    prompts: AuthPromptItem[];
  };
}

export type HostEventName = keyof HostEvents;
