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

export interface AppSettings {
  /** "system" follows the OS locale. */
  locale: 'system' | 'en' | 'zh-CN';
  theme: 'dark' | 'light' | 'system';
  terminal: TerminalSettings;
  plugins: {
    /** Plugin ids the user disabled. */
    disabled: string[];
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
  plugins: { disabled: [], seenPanels: [] },
  closeConnectionWithLastTerminal: true,
};

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

  // ---- credentials (OS keychain; service name "dev.navishell", account = serverId) ----
  credential_exists: { args: { serverId: string }; result: boolean };
  credential_set: { args: { serverId: string; password: string }; result: void };
  credential_delete: { args: { serverId: string }; result: void };

  // ---- ssh connections ---------------------------------------------------
  /**
   * Connect and authenticate.
   * - `password` omitted => use the keychain; none stored => reject `PasswordRequired`.
   * - `savePassword` => store `password` in the keychain after a successful auth.
   * - Host keys: unknown host => trust on first use, store, `hostKeyStatus: 'new'`.
   *   Mismatch => reject `HostKeyMismatch` with `data: { fingerprint, expectedFingerprint }`
   *   unless `trustHostKey` is true (then replace the stored key).
   * - Wrong password => `AuthFailed`. Network/DNS/timeout => `ConnectFailed` / `Timeout`.
   */
  ssh_connect: {
    args: { serverId: string; password?: string; savePassword?: boolean; trustHostKey?: boolean };
    result: ConnectionInfo;
  };
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

export interface HostEvents {
  /** The SSH session ended (remote closed, network error, or `ssh_disconnect`). */
  'connection:closed': { connectionId: string; reason: string | null };
  /** The shell channel ended. Emitted exactly once per terminal. */
  'terminal:exit': { terminalId: string; exitCode: number | null };
}

export type HostEventName = keyof HostEvents;
