# NaviShell architecture

NaviShell is a cross-platform SSH terminal built with **Tauri 2** (Rust core) and
**React 19 + TypeScript** (host UI), with a **VS Code-like dockable layout** (dockview) and a
**frontend plugin system**. The core stays minimal; everything else is a plugin.

Decisions below were confirmed with the project owner on 2026-10-18 and are not up for
re-discussion inside a task. If something is genuinely unspecified, pick the simplest
option that keeps the contracts intact and note it in your report.

## 1. Scope of v1

| Area                | In v1                                                                  | Deferred (GitHub issues) |
| ------------------- | ---------------------------------------------------------------------- | ------------------------ |
| Login               | username + password                                                    | private key, ssh-agent, ProxyJump, keyboard-interactive |
| Core features       | server records, connect, terminal, one-shot exec, SFTP primitives      | local shell              |
| Built-in plugins    | SFTP file manager, command completion (history + dictionary)           | remote-aware completion  |
| Plugin sources      | built-in + `<appData>/plugins/<id>/`                                   | install from URL         |
| Credentials         | OS keychain (`keyring` crate, service `dev.navishell`, account = serverId) | –                    |
| UI language         | zh-CN + en (i18next), default follows system                           | –                        |
| Release             | GitHub Release via tauri-action; Win x64, macOS x64+arm64, Linux x64+arm64 | auto-updater         |

Nothing is compiled locally beyond `cargo check`/`clippy`, `tsc` and `vite build`.
Packaging only happens in GitHub Actions.

## 2. Repository layout

```
NaviShell/
├─ package.json               host app + pnpm workspace root (scripts: build, typecheck, lint)
├─ pnpm-workspace.yaml        packages/*
├─ index.html, vite.config.ts, tsconfig*.json, eslint.config.js
├─ src/                       React host
│  ├─ main.tsx, App.tsx
│  ├─ core/
│  │  ├─ ipc/contract.ts      <-- IPC CONTRACT (commands, args, results, events)
│  │  ├─ ipc/client.ts        typed invoke wrappers (`call('ssh_connect', {...})`)
│  │  ├─ stores/              zustand stores: settings, servers, connections, terminals, ui, plugins
│  │  ├─ plugins/             plugin host: loader (builtin + external), require shim, PluginContext impl, registries
│  │  ├─ terminal/            xterm factory, TerminalHandle impl
│  │  └─ i18n/                i18next setup, locales/en.json, locales/zh-CN.json
│  ├─ app/
│  │  ├─ layout/              DockLayout (dockview), default layout, persistence
│  │  ├─ panels/              ServersPanel, TerminalPanel, HomePanel, SettingsPanel, PluginPanel (generic)
│  │  └─ components/          Dialogs (confirm/prompt/password/host-key), Toasts, ContextMenu, StatusBar, TopBar
│  └─ styles/                 CSS variables + global styles (dark theme first)
├─ public/plugins/            GENERATED built-in plugin bundles (gitignored)
├─ packages/
│  ├─ plugin-api/             @navishell/plugin-api  <-- PLUGIN CONTRACT (types + helpers)
│  ├─ plugin-sftp/            built-in file manager plugin
│  └─ plugin-completion/      built-in command completion plugin
├─ scripts/plugin-vite.mjs    shared Vite config for plugin bundles (CJS, externals)
├─ src-tauri/                 Rust core
│  ├─ Cargo.toml, tauri.conf.json, capabilities/default.json, icons/
│  └─ src/
│     ├─ lib.rs               Builder, state, command registration
│     ├─ error.rs             AppError { code, message, data } -> HostError on the wire
│     ├─ state.rs             AppState (connections, terminals, transfers)
│     ├─ storage.rs           JSON file helpers under app data dir
│     ├─ settings.rs          settings_get/set, layout_get/set, app_info
│     ├─ servers.rs           servers_* commands (servers.json)
│     ├─ secrets.rs           credential_* (keyring)
│     ├─ known_hosts.rs       known_hosts.json (TOFU store)
│     ├─ ssh/{mod,connection,terminal,exec,sftp}.rs
│     └─ plugins.rs           plugins_list_external, plugins_read_file, plugin_storage_*
└─ .github/workflows/         ci.yml (check on push/PR), release.yml (tag v* -> draft release)
```

## 3. Contracts

- **IPC contract**: `src/core/ipc/contract.ts`. Command names, argument names (camelCase on
  the wire; Rust params are snake_case and Tauri maps them), results, error codes and
  events. The Rust side implements exactly this surface; the host's `client.ts` wraps it.
- **Plugin contract**: `packages/plugin-api/src/index.ts`. Plugins only ever see
  `PluginContext`; they never call `invoke` directly.

Changing a contract means updating both sides; prefer additive changes.

## 4. Runtime model

### Rust core

- One `Connection` per `ssh_connect` call: a `russh::client::Handle` plus metadata.
  Multiple terminals and one lazily-opened SFTP session share a connection.
- `term_open` opens a session channel, requests a PTY (`term`, cols, rows) and a shell,
  then spawns a tokio task that `select!`s between `channel.wait()` (remote -> JS via
  `Channel<tauri::ipc::Response>` raw bytes) and an mpsc receiver of outgoing commands
  (`Write(Vec<u8>)`, `Resize(cols, rows)`, `Close`). On `Eof`/`Close`/`ExitStatus` the task
  emits `terminal:exit` once and removes the terminal.
- `ssh_exec` opens a fresh channel, `exec(true, cmd)`, collects stdout/stderr until close,
  with a timeout (default 30 s).
- SFTP: `request_subsystem(true, "sftp")`, `SftpSession::new(channel.into_stream())`, cached
  per connection. Transfers stream in 256 KiB chunks and report progress through
  `Channel<TransferProgress>`; a `CancellationToken` per `transferId` supports `sftp_cancel`.
- Host keys: `known_hosts.json` maps `"host:port"` -> `{ keyType, publicKey (openssh), fingerprint }`.
  The `Handler::check_server_key` implementation compares against the stored key and reports
  `Unknown | Match | Mismatch { expected }` back to `ssh_connect` which decides per contract.
- When the session dies (handler `disconnected` or channel task error), emit
  `connection:closed` and drop all terminals of that connection (each emits `terminal:exit`).
- Files in app data dir: `servers.json`, `settings.json`, `layout.json`, `known_hosts.json`,
  `plugin-data/<pluginId>.json`, `plugins/<id>/…`, `logs/`.
- Errors: `AppError` is `Serialize` as `{ code, message, data? }` with codes from
  `HostErrorCode`. Never panic across the IPC boundary.

### Host (React)

- Startup: `settings_get` -> init i18n -> `app_info` -> load plugins -> mount layout.
- **Plugin loading**: built-ins are listed in `public/builtin-plugins.json` (committed:
  `["navishell.sftp", "navishell.completion"]`) and fetched over HTTP
  (`/plugins/<id>/plugin.json`, `/plugins/<id>/main.js`, styles). External plugins come
  from `plugins_list_external` + `plugins_read_file`. Both paths end in the same loader:
  inject styles, evaluate `main.js` with `new Function('module','exports','require', code)`,
  where `require` resolves only the host-provided modules listed in the plugin API docs,
  then call `activate(ctx)`. Disabled plugins (settings) are skipped. Activation errors are
  caught, logged and shown in Settings > Plugins; they never break the host.
- **Panels**: one registry for core panels (`core:servers`, `core:settings`) and plugin panels
  (`<pluginId>:<panelId>`). Dockview uses a single generic `panel` component whose params are
  `{ panelId }`; it looks the definition up in the registry and renders it (or a
  placeholder if the plugin is not loaded/disabled). Terminal tabs use the `terminal`
  component with params `{ terminalId, serverId, serverName }` and `renderer: 'always'`.
  The center group always contains the non-closable `core:home` panel so there is always a
  terminal area.
- **Layout persistence**: `api.toJSON()` debounced -> `layout_set`. On restore, terminal
  panels whose session no longer exists render a "session ended / reconnect" placeholder.
  If `fromJSON` throws, fall back to the default layout.
- **Connect flow** (`servers.connect`): if a connection for the server exists, reuse it.
  Otherwise `ssh_connect({ serverId })`; on `PasswordRequired` show the password dialog
  (with "save to keychain" checkbox) and retry with `password`/`savePassword`; on
  `HostKeyMismatch` show the fingerprint dialog and retry with `trustHostKey: true` if the
  user accepts; `hostKeyStatus: 'new'` shows an info toast with the fingerprint.
- **Terminal**: xterm 6 (`@xterm/xterm`), fit addon, web-links, unicode11, WebGL addon when
  enabled (fallback to DOM renderer on failure; the canvas renderer no longer exists).
  `onData` -> `term_write`; `Channel<ArrayBuffer>` -> `xterm.write(new Uint8Array(buf))`;
  ResizeObserver + fit -> `term_resize`. Closing the last terminal of a connection
  disconnects it when `closeConnectionWithLastTerminal` is on.
- **i18n**: i18next with namespaces; host strings in `host` namespace, each plugin gets its
  own namespace via `ctx.i18n.addResources`.

### Plugins

- `navishell.sftp`: right-docked panel bound to the active terminal's connection. Path bar,
  entry list (name/size/mtime/perms), navigation, new folder, rename, delete (confirm),
  upload (file picker), download (save dialog), drag-and-drop upload (when the WebView
  provides file paths), transfer list with progress and cancel. Quick text edit for small
  files is optional.
- `navishell.completion`: terminal overlay. Tracks the current input line per terminal from
  `onInput` (handles printable chars, backspace, Ctrl-U/Ctrl-C, Enter; resets on cursor
  keys/Tab), records executed commands into per-server history (`storage`), seeds history
  from `~/.bash_history` / `~/.zsh_history` via `connections.exec` on first open, merges
  with a built-in dictionary of common commands (+ subcommands for git/docker/systemctl…),
  shows a popup under the cursor after ≥2 chars, navigates with ↑/↓, accepts with Tab/→
  by sending Ctrl-U + full command, dismisses on Esc. Must never swallow keys when the
  popup is hidden.

## 5. Conventions

- TypeScript strict, `noUncheckedIndexedAccess`. No `any` without a comment.
- Rust: `cargo fmt`, `cargo clippy -- -D warnings` clean. `tracing` for logs.
- CSS: plain CSS with variables defined in `src/styles/theme.css` (dark first; light values
  under `[data-theme="light"]`). Plugins may ship their own CSS but should use the host
  variables (`--ns-bg`, `--ns-fg`, `--ns-border`, `--ns-accent`, …) for consistency.
- Icons: `lucide-react`.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `ci:`).
