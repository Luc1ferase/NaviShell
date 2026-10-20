# NaviShell architecture

NaviShell is a cross-platform SSH terminal built with **Tauri 2** (Rust core) and
**React 19 + TypeScript** (host UI), with a **VS Code-like dockable layout** (dockview) and a
**frontend plugin system**. The core stays minimal; everything else is a plugin.

Decisions below were confirmed with the project owner on 2026-10-18 and are not up for
re-discussion inside a task. If something is genuinely unspecified, pick the simplest
option that keeps the contracts intact and note it in your report.

## 1. Scope

v1 shipped password login only. Everything marked *(post-v1)* was added afterwards on
`feat/auth-methods-local-terminal` (issues #1, #2, #3, #4, #6, #8) and on
`feat/updater-plugin-install` (issues #5 and #7); all of it goes out with the next
release, and no issue is left open.

| Area                | Shipped                                                                | Deferred (GitHub issues) |
| ------------------- | ---------------------------------------------------------------------- | ------------------------ |
| Login               | username + password; private key with passphrase, ssh-agent, keyboard-interactive fallback and ProxyJump *(post-v1)* | – |
| Core features       | server records, connect, terminal, one-shot exec, SFTP primitives; local shell terminals *(post-v1)* | – |
| Built-in plugins    | SFTP file manager, command completion (history + dictionary; remote `PATH`, directory listings and cwd tracking *(post-v1)*) | – |
| Plugin sources      | built-in + `<appData>/plugins/<id>/`; install from a zip URL or a local zip, and uninstall, from Settings; marketplace list from a registry index JSON *(post-v1)* | – |
| Credentials         | OS keychain (`keyring` crate, service `dev.navishell`, account `<serverId>`, or `<serverId>:passphrase` for a key passphrase) | – |
| UI language         | zh-CN + en built in (i18next); ja + zh-TW as built-in language-pack plugins; packs register via `ctx.i18n.registerLocale` | – |
| Release             | GitHub Release via tauri-action; Win x64, macOS x64+arm64, Linux x64+arm64; signed updater artifacts + `latest.json` *(post-v1)* | – |
| Updates             | in-app check against the latest GitHub Release, download, install and restart *(post-v1)* | – |

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
│  │  └─ i18n/                i18next setup, locales/en.json, locales/zh-CN.json; language packs add more
│  ├─ app/
│  │  ├─ layout/              DockLayout (dockview), default layout, persistence
│  │  ├─ panels/              ServersPanel, TerminalPanel, HomePanel, SettingsPanel, PluginPanel (generic)
│  │  └─ components/          Dialogs (confirm/prompt/password/host-key), Toasts, ContextMenu, StatusBar, TopBar
│  └─ styles/                 CSS variables + global styles (dark theme first)
├─ public/plugins/            GENERATED built-in plugin bundles (gitignored)
├─ packages/
│  ├─ plugin-api/             @navishell/plugin-api  <-- PLUGIN CONTRACT (types + helpers)
│  ├─ plugin-sftp/            built-in file manager plugin
│  ├─ plugin-completion/      built-in command completion plugin
│  └─ plugin-hwmon/           hardware monitor; NOT bundled: packed by scripts/pack-plugin.mjs, published by plugin-release.yml
├─ scripts/plugin-vite.mjs    shared Vite config for plugin bundles (CJS, externals)
├─ scripts/pack-plugin.mjs    deterministic zip + SHA-256 of a built plugin (for registry/plugins.json)
├─ registry/                  plugins.json (marketplace index), its JSON Schema, submission guide
├─ src-tauri/                 Rust core
│  ├─ Cargo.toml, tauri.conf.json, capabilities/default.json, icons/
│  └─ src/
│     ├─ lib.rs               Builder, state, command registration
│     ├─ error.rs             AppError { code, message, data } -> HostError on the wire
│     ├─ state.rs             AppState (connections, terminals, transfers)
│     ├─ storage.rs           JSON file helpers under app data dir
│     ├─ settings.rs          settings_get/set, layout_get/set, app_info
│     ├─ fonts.rs             fonts_list (installed families for the Settings font picker)
│     ├─ servers.rs           servers_* commands (servers.json)
│     ├─ secrets.rs           credential_* (keyring)
│     ├─ known_hosts.rs       known_hosts.json (TOFU store)
│     ├─ local_pty.rs         term_open_local (local shells through portable-pty)
│     ├─ local_exec.rs        local_exec (one-shot local command for plugins, no shell, no window)
│     ├─ ssh/{mod,connection,terminal,exec,sftp}.rs
│     └─ plugins.rs           plugins_list_external/read_file/install_*/uninstall/fetch_registry, plugin_storage_*
└─ .github/workflows/         ci.yml (check on push/PR), release.yml (tag v* -> draft release), plugin-release.yml (dispatch -> plugin zip pre-release)
```

## 3. Contracts

- **IPC contract**: `src/core/ipc/contract.ts`. Command names, argument names (camelCase on
  the wire; Rust params are snake_case and Tauri maps them), results, error codes and
  events. The Rust side implements exactly this surface; the host's `client.ts` wraps it.
- **Plugin contract**: `packages/plugin-api/src/index.ts`. Plugins only ever see
  `PluginContext`; they never call `invoke` directly. `ctx.local` (platform, arch and a
  shell-less one-shot `exec`) is the local counterpart of `ctx.connections.exec`.

Changing a contract means updating both sides; prefer additive changes.

## 4. Runtime model

### Rust core

- One `Connection` per `ssh_connect` call: a `russh::client::Handle` plus metadata.
  Multiple terminals and one lazily-opened SFTP session share a connection.
- **Authentication** follows the server record's `auth` method and is decided entirely in
  `ssh/connection.rs`: `password` (arg, else keychain, else reject `PasswordRequired`),
  `key` (OpenSSH key file; passphrase from the arg, else keychain account
  `<serverId>:passphrase`, else reject `PassphraseRequired`), `agent` (Windows OpenSSH
  named pipe, `SSH_AUTH_SOCK` elsewhere; `AgentUnavailable` when no agent answers).
- **Keyboard-interactive** is a fallback, never a method of its own: when the chosen method
  is rejected or not offered and the server offers it, the core emits `auth:prompt`
  (`requestId`, prompts with their echo flags) and parks on a oneshot channel in `AppState`
  until `ssh_auth_respond` arrives with the same `requestId` (max 180 s; `responses: null`
  cancels). A single hidden prompt that mentions "password" is answered automatically with
  the password already at hand, once, before the user is asked.
- **ProxyJump**: the caller connects to the jump host first and passes its `connectionId`
  as `viaConnectionId`. The target session is carried over a direct-tcpip channel of that
  connection, and `ConnectionInfo.viaConnectionId` records the link so closing the jump
  connection also closes everything tunnelled through it.
- `term_open` opens a session channel, requests a PTY (`term`, cols, rows) and a shell,
  then spawns a tokio task that `select!`s between `channel.wait()` (remote -> JS via
  `Channel<tauri::ipc::Response>` raw bytes) and an mpsc receiver of outgoing commands
  (`Write(Vec<u8>)`, `Resize(cols, rows)`, `Close`). On `Eof`/`Close`/`ExitStatus` the task
  emits `terminal:exit` once and removes the terminal.
- `term_open_local` (`local_pty.rs`) is the same contract without a connection: a
  `portable-pty` pty, a shell spawned into it, and three OS threads for its lifetime - one
  draining the master into the same `Channel<Response>`, one receiving the same `TermCmd`s
  (`Resize` calls `master.resize`, `Close` kills the child), and one parked on
  `child.wait()`, which is the single place that emits `terminal:exit`. Because
  `TerminalEntry.connection_id` is `Option<String>` (`None` for local shells),
  `term_write` / `term_resize` / `term_close` work unchanged and `take_terminals_of` never
  touches a local terminal when a connection dies. Program resolution: the `program`
  argument (the host passes `settings.localShell`), else `pwsh.exe` when it is on `PATH`
  and `powershell.exe` otherwise on Windows, else `$SHELL`, `/bin/bash`, `/bin/sh` on unix.
  `cwd` falls back to the home directory; the environment is inherited plus `TERM` and
  `COLORTERM=truecolor`.
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
- **Plugin installation** (`plugins.rs`): `plugins_install_from_url` streams an http(s)
  zip into `<appData>/tmp/install-*/` (60 s deadline, 50 MiB cap enforced against both
  `Content-Length` and the running total), optionally checks a hex SHA-256, and hands over
  to the same path as `plugins_install_from_file`. Unpacking runs in `spawn_blocking` and
  accepts an entry only when `zip`'s `enclosed_name()` does (that one call covers `..`,
  absolute paths and Windows drive/UNC prefixes); symlink entries are skipped. The
  manifest is read from the archive root or from its single top-level directory, and `id`,
  `version` and `main` are validated before anything moves — `id` must match the plugin
  API's shape and must not start with `navishell.`. Only then is the staged directory
  *renamed* into `<appData>/plugins/<id>`, so a half-installed plugin is never visible to
  `plugins_list_external`; when replacing, the old directory is parked in the scratch
  space first and restored if the rename fails. The scratch directory is a `TempDir`, so
  every error path cleans up, and `<appData>/tmp` is emptied again on startup.
  `plugins_uninstall` removes the directory (never following a symlink in its place) and
  `plugin-data/<id>.json` with it.
- **Plugin marketplace** (`plugins.rs`): `plugins_fetch_registry` downloads a registry
  index (`settings.plugins.registryUrl`, defaulting to `registry/plugins.json` of this
  repository on `raw.githubusercontent.com`) into memory — http(s) only, 15 s deadline,
  1 MiB cap against both `Content-Length` and the running total, same shared
  `parse_http_url`/`http_client`/`http_error` helpers as the installer. The index is
  parsed with its entries left as raw JSON, so an unreadable entry is dropped and logged
  instead of failing the whole listing; an entry is dropped for the same reasons it could
  never be installed (`id` outside `^[a-z0-9][a-z0-9._-]*$` or starting with `navishell.`,
  empty `version`, non-http(s) `url`, missing `name`). Nothing is cached and nothing is
  downloaded from the entries: installing a listed plugin is an ordinary
  `plugins_install_from_url` call with the entry's `url` and `sha256`.
- **Updates** (issue #5): `tauri-plugin-updater` + `tauri-plugin-process`, registered
  under `#[cfg(desktop)]`. `plugins.updater` in `tauri.conf.json` holds the minisign
  public key and the single endpoint
  `https://github.com/Luc1ferase/NaviShell/releases/latest/download/latest.json`;
  `bundle.createUpdaterArtifacts` makes the release build sign every bundle. The whole
  flow lives on the JS side (`@tauri-apps/plugin-updater` `check()` → `downloadAndInstall()`
  → `relaunch()` from `@tauri-apps/plugin-process`); the Rust core adds no command of its
  own, which is why no `update_*` entry exists in the IPC contract.
- Files in app data dir: `servers.json`, `settings.json`, `layout.json`, `known_hosts.json`,
  `plugin-data/<pluginId>.json`, `plugins/<id>/…`, `logs/`, `tmp/`.
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
- **Installing plugins**: Settings > Plugins offers "install from URL" (optionally with an
  expected SHA-256) and "install from file", both calling `plugins_install_*`, plus
  uninstall. On `InvalidArgument` carrying `data.exists` the UI asks whether to replace
  the installed version (`data.version`, `null` when its manifest is unreadable) and
  retries with `replace: true`. After any of those, the plugin list is reloaded in place —
  no restart. The marketplace list in the same panel comes from `plugins_fetch_registry`
  (fetched on demand, not at startup) and installs a chosen entry through the very same
  "install from URL" path, passing the entry's `sha256` along.
- **Update check**: with `settings.updates.checkOnStartup` the host runs `check()` from
  `@tauri-apps/plugin-updater` once after mount and offers the new version in a toast.
  Accepting runs `downloadAndInstall()` with progress, then `relaunch()` from
  `@tauri-apps/plugin-process`. The startup check is silent in every outcome - no update,
  `null`, or a rejection are all only logged - so a release that is still a draft is a
  no-op rather than an error on every launch. The same check sits in Settings > About,
  where it is explicit and does report a failure; outside a packaged app it says so
  instead of calling the plugin.
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
  When the record has a `jumpServerId`, connect that server first (recursively) and pass
  its id as `viaConnectionId`. Then `ssh_connect({ serverId })`; on `PasswordRequired` show
  the password dialog (with "save to keychain" checkbox) and retry with
  `password`/`savePassword`; on `PassphraseRequired` the same with the key passphrase and
  `savePassphrase`; `AgentUnavailable` and `AuthFailed` surface as errors; on
  `HostKeyMismatch` show the fingerprint dialog and retry with `trustHostKey: true` if the
  user accepts; `hostKeyStatus: 'new'` shows an info toast with the fingerprint.
- **Keyboard-interactive prompts**: a global `auth:prompt` listener opens a dialog with one
  field per prompt (hidden when `echo` is false) and answers with
  `ssh_auth_respond({ requestId, responses })`, or `responses: null` when the user cancels.
  The dialog is not tied to the connect call, so it works for a retry in the middle of a
  multi-step authentication.
- **Local terminals**: `terminals.openLocal()` / the "new local terminal" action calls
  `term_open_local` with `settings.localShell.program` and `args`; the terminal tab is the
  same component with `kind: 'local'` and no `serverId`/`connectionId`, and it reports its
  end through the same `terminal:exit` event.
- **Terminal**: xterm 6 (`@xterm/xterm`), fit addon, web-links, unicode11, WebGL addon when
  enabled (fallback to DOM renderer on failure; the canvas renderer no longer exists).
  `onData` -> `term_write`; `Channel<ArrayBuffer>` -> `xterm.write(new Uint8Array(buf))`;
  ResizeObserver + fit -> `term_resize`. Closing the last terminal of a connection
  disconnects it when `closeConnectionWithLastTerminal` is on.
- **i18n**: i18next with namespaces; host strings in `host` namespace, each plugin gets its
  own namespace via `ctx.i18n.addResources`. Only `en` and `zh-CN` are built in: other UI
  languages are language-pack plugins (`packages/lang-ja`, `packages/lang-zh-tw`) that call
  `ctx.i18n.registerLocale` with a host bundle plus bundles for other plugins (keyed by plugin
  id). The available-locale list is dynamic; `settings.locale` is an open string, and a locale
  whose pack is disabled falls back to the system/built-in one. A pack may declare a
  `fallback` locale that is consulted before `en` (zh-TW → zh-CN).

### Plugins

- `navishell.sftp`: right-docked panel bound to the active terminal's connection (a local
  terminal has none, so it is ignored and the panel keeps whatever the dropdown selected).
  Path bar,
  entry list (name/size/mtime/perms), navigation, new folder, rename, delete (confirm),
  upload (file picker), download (save dialog), drag-and-drop upload (when the WebView
  provides file paths), transfer list with progress and cancel. Quick text edit for small
  files is optional.
- `navishell.completion`: terminal overlay. Tracks the current input line per terminal from
  `onInput` (handles printable chars, backspace, Ctrl-U/Ctrl-C, Enter; resets on cursor
  keys/Tab), records executed commands into history keyed by server id (or `local` for
  local shells) in `storage`, seeds history from `~/.bash_history` / `~/.zsh_history` via
  `connections.exec` on first open, shows a popup under the cursor after ≥2 chars,
  navigates with ↑/↓, accepts with Tab/→ by sending Ctrl-U + full command, dismisses on
  Esc. Must never swallow keys when the popup is hidden.
  Four candidate sources, each badged in the popup and ranked in this order: `path` (entries
  of the remote directory the current token points at), `history`, `remote` (executables on
  the remote `PATH` from `compgen -c`, fetched once per connection and dropped when the
  connection closes) and `dict` (the built-in command dictionary). The engine stays pure and
  synchronous: every remote lookup is a cache read that may *start* a background `exec`, and
  a cold cache simply means fewer candidates.
  Path completion needs the shell's cwd, which the plugin learns from OSC 7 (and OSC 133/633
  `P;Cwd=`) through `terminal.xterm.parser.registerOscHandler`. Until a shell reports one,
  relative tokens are resolved against `$HOME` and the popup badge says so (`path ~`). The
  opt-in `toggleShellIntegration` command (stored in plugin storage, default off) writes a
  one-line hook into each new SSH shell, 500 ms after its first output (bash: `DEBUG` trap +
  `PROMPT_COMMAND`; zsh: `preexec`/`precmd`; bash-preexec hook arrays are reused when
  present). The hook makes the shell emit OSC 7 (cwd) after every prompt, `OSC 633;E;<cmd>`
  right before a command runs and `OSC 133;D;<exit>` when it finishes. When `E` reports are
  seen, history is recorded from the exact command text instead of the keystroke-tracked
  line (the pending keystroke candidate is dropped), and commands that exit with 127
  (command not found) are skipped.

- `luciferase.hwmon` (not bundled; installed from the marketplace): a centre-docked
  hardware dashboard. One target at a time - this machine through `ctx.local.exec` or any
  open SSH connection through `ctx.connections.exec` (platform probed once with
  `uname -s`) - is sampled on a timer while the panel is visible. Each platform has one
  collector (`packages/plugin-hwmon/src/collect/`): a self-contained script (POSIX `sh` on
  Linux/macOS, PowerShell on Windows) that prints what is available without ever failing
  as a whole, plus a parser that turns it into a `Snapshot` (host, CPU incl. per-core
  usage from two `/proc/stat` readings, memory, GPUs via `nvidia-smi` / `rocm-smi` with
  per-GPU processes, disks). The UI keeps a 120-point history for sparklines and switches
  the GPU section from cards to a dense table at six GPUs, with sorting by utilisation,
  memory or temperature, so 8-16 GPU servers stay readable.

## 5. Conventions

- TypeScript strict, `noUncheckedIndexedAccess`. No `any` without a comment.
- Rust: `cargo fmt`, `cargo clippy -- -D warnings` clean. `tracing` for logs.
- Terminal palettes are independent of the UI theme: `src/core/terminal/schemes.ts` holds the
  built-in schemes, `settings.terminal.colorScheme.{dark,light}` names one per resolved UI
  theme, and `settings.terminal.minimumContrastRatio` is passed straight to xterm.
- The terminal font stays a plain CSS `font-family` list (`settings.terminal.fontFamily`).
  The Settings picker (`src/core/terminal/fonts.ts`) offers the default stack ("automatic"),
  the families `fonts_list` finds on the machine (`src-tauri/src/fonts.rs`, via `fontdb`;
  monospace by default) and a custom escape hatch; a picked family is stored as
  `"<family>", <default stack>` so glyphs it lacks still fall back.
- CSS: plain CSS with variables defined in `src/styles/theme.css` (dark first; light values
  under `[data-theme="light"]`). Plugins may ship their own CSS but should use the host
  variables (`--ns-bg`, `--ns-fg`, `--ns-border`, `--ns-accent`, …) for consistency.
- Icons: `lucide-react`.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `ci:`).
