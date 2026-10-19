# Dependency notes (verified against docs on 2026-10-18)

Versions pinned in this repo are newer than most training data. These notes record the
API facts that were verified from docs.rs / official docs so nobody has to guess.

## Rust

### tauri 2.12

- `#[tauri::command]` params are snake_case in Rust and camelCase on the JS side by default.
- Streaming raw bytes: declare `on_data: tauri::ipc::Channel<tauri::ipc::Response>` and send
  `on_data.send(tauri::ipc::Response::new(bytes_vec))`. The JS side declares
  `new Channel<ArrayBuffer>()` and receives an `ArrayBuffer` per message.
- JSON streaming: `Channel<T: Serialize + Clone>` with `channel.send(value)`.
- Events: `app.emit("name", payload)` (`use tauri::Emitter`). Listen in JS with
  `listen<T>("name", cb)` from `@tauri-apps/api/event`.
- App data dir: `app.path().app_data_dir()?` (`use tauri::Manager`). Create it on startup.
- `tauri::generate_context!()` requires `frontendDist` (`../dist`) to exist at compile time;
  before `cargo check`, ensure `dist/index.html` exists (`vite build` creates it; a stub file
  is fine for checking).
- State: `app.manage(AppState::default())`, commands take `state: tauri::State<'_, AppState>`.
  Async commands returning `Result<T, E>` need `E: Serialize`. Tauri runs on its own tokio
  runtime; `tokio::spawn` works inside async commands.

### russh 0.64

```rust
use russh::client::{self, Handle, Handler, AuthResult, Config, DisconnectReason};
use russh::keys::{PublicKeyOrCertificate, HashAlg};
use russh::{ChannelMsg, Disconnect};

struct ClientHandler { /* host key policy state */ }
impl Handler for ClientHandler {
    type Error = russh::Error;
    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let pk = key.public_key();                              // russh::keys::PublicKey (= ssh_key::PublicKey)
        let fp = pk.fingerprint(HashAlg::Sha256).to_string();   // "SHA256:..."
        let openssh = pk.to_openssh()?;                         // "ssh-ed25519 AAAA..."
        let algo = pk.algorithm().to_string();                  // "ssh-ed25519"
        Ok(true)
    }
    async fn disconnected(&mut self, reason: DisconnectReason<Self::Error>) -> Result<(), Self::Error> { ... }
}

let config = Arc::new(Config { inactivity_timeout: None, keepalive_interval: Some(Duration::from_secs(30)), keepalive_max: 3, ..Default::default() });
let mut handle: Handle<ClientHandler> = client::connect(config, (host.as_str(), port), handler).await?;
let res: AuthResult = handle.authenticate_password(user, password).await?;
if !res.success() { /* AuthResult::Failure { remaining_methods, partial_success } */ }

let mut channel = handle.channel_open_session().await?;       // russh::Channel<client::Msg>
channel.request_pty(true, "xterm-256color", cols, rows, 0, 0, &[]).await?;
channel.request_shell(true).await?;
channel.data_bytes(bytes).await?;                              // or channel.data(reader)
channel.window_change(cols, rows, 0, 0).await?;
channel.eof().await?; channel.close().await?;
while let Some(msg) = channel.wait().await {                  // Option<ChannelMsg>
    match msg {
        ChannelMsg::Data { data } => { /* data: bytes::Bytes */ }
        ChannelMsg::ExtendedData { data, ext } => { /* ext == 1 => stderr */ }
        ChannelMsg::ExitStatus { exit_status } => {}
        ChannelMsg::Eof | ChannelMsg::Close => {}
        _ => {}
    }
}
// exec: channel.exec(true, command).await?; then read Data/ExtendedData until Close/Eof.
// subsystem: channel.request_subsystem(true, "sftp").await?; let stream = channel.into_stream();
// channel.split() -> (ChannelReadHalf { wait() }, ChannelWriteHalf { data_bytes, window_change, eof, close })
handle.disconnect(Disconnect::ByApplication, "", "en").await?;
handle.is_closed();
```

`ChannelMsg` is `#[non_exhaustive]` – always include a `_ => {}` arm. `Handle` is NOT `Clone`
in 0.64; keep it in an `Arc` (`channel_open_session`, `disconnect`, `is_closed` take `&self`).
Crypto backend: the default `aws-lc-rs` needs NASM on Windows, so the repo uses
`default-features = false, features = ["ring", "flate2", "rsa"]`.

### russh-sftp 3.0

```rust
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{OpenFlags, FileAttributes};
let sftp = SftpSession::new(channel.into_stream()).await?;
let home = sftp.canonicalize(".").await?;
for entry in sftp.read_dir(path).await? {                       // ReadDir: Iterator<Item = DirEntry>
    let name: String = entry.file_name();
    let meta: FileAttributes = entry.metadata();                // size: Option<u64>, uid/gid: Option<u32>, user/group: Option<String>, permissions: Option<u32>, atime/mtime: Option<u32>
    meta.is_dir(); meta.is_symlink(); meta.is_regular(); meta.len();
}
let meta = sftp.metadata(path).await?;
sftp.create_dir(path).await?; sftp.rename(from, to).await?;
sftp.remove_file(path).await?; sftp.remove_dir(path).await?;
let mut f = sftp.open(path).await?;                            // read-only; File: AsyncRead + AsyncWrite + AsyncSeek (tokio)
let mut f = sftp.create(path).await?;                          // write/create/truncate
let mut f = sftp.open_with_flags(path, OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE).await?;
f.write_all(&buf).await?; f.shutdown().await?;                 // close via AsyncWriteExt::shutdown or f.close().await
sftp.close().await?;
```

Note: `read_dir` entries include `.` and `..` on some servers – filter them.

### keyring 4.2 (feature `v1`, default)

```rust
use keyring::{Entry, Error};
let entry = Entry::new("dev.navishell", server_id)?;   // Result<Entry>
entry.set_password(&pw)?; let pw = entry.get_password()?; entry.delete_credential()?;
match entry.get_password() { Err(Error::NoEntry) => None, ... }
```

All sync; call from `tauri::async_runtime::spawn_blocking` or a blocking command. Linux uses
Secret Service over zbus (pure Rust, no libdbus needed). If the store is unavailable the
calls return `Error::NoDefaultStore` / platform errors – surface as `Keyring` AppError.

## Frontend

### dockview-react 8.6

- Import: `import { DockviewReact, themeDark, DockviewDefaultTab } from 'dockview-react'`
  and `import 'dockview-react/dist/styles/dockview.css'`.
- Props: `components`, `tabComponents`, `defaultTabComponent`, `watermarkComponent`,
  `leftHeaderActionsComponent`, `rightHeaderActionsComponent`, `prefixHeaderActionsComponent`,
  `theme={themeDark}` (or a custom `DockviewTheme` object), `onReady`, `singleTabMode`.
- Panel component receives `IDockviewPanelProps<{ ...params }>`: `props.api`
  (`DockviewPanelApi`: `id`, `title`, `isActive`, `isVisible`, `width`, `height`,
  `setTitle`, `setActive`, `close`, `onDidActiveChange`, `onDidVisibilityChange`,
  `onDidDimensionsChange`), `props.containerApi` (`DockviewApi`), `props.params`.
- `api.addPanel({ id, component, title, params, renderer: 'always' | 'onlyWhenVisible',
  tabComponent, position: { referencePanel | referenceGroup, direction: 'left'|'right'|'above'|'below'|'within', index? },
  initialWidth?, initialHeight? })`.
- `api.toJSON()` / `api.fromJSON(json)`; `api.onDidLayoutChange`, `onDidActivePanelChange`
  (`event.panel`), `onDidAddPanel`, `onDidRemovePanel`, `onDidMovePanel`; `api.getPanel(id)`,
  `api.panels`, `api.groups`, `api.activePanel`, `api.activeGroup`.
- Hide the close button: custom tab `(props) => <DockviewDefaultTab hideClose {...props} />`
  registered in `tabComponents` and referenced by `tabComponent` in `addPanel`.
- Use `renderer: 'always'` for terminal panels so xterm keeps its DOM when hidden.

### @xterm/xterm 6.0

- `import { Terminal } from '@xterm/xterm'; import '@xterm/xterm/css/xterm.css'`.
- Addons: `@xterm/addon-fit` (`FitAddon`), `@xterm/addon-web-links`, `@xterm/addon-search`,
  `@xterm/addon-unicode11` (`term.unicode.activeVersion = '11'`), `@xterm/addon-webgl`
  (`WebglAddon`; listen to `onContextLoss` and dispose; fall back to the DOM renderer).
  The canvas renderer addon no longer exists.
- `term.onData(cb)` (user input string), `term.onBinary`, `term.write(Uint8Array | string)`,
  `term.onResize`, `term.attachCustomKeyEventHandler((ev) => boolean)` (return false to
  swallow), `term.buffer.active.cursorX/cursorY`, `term.rows/cols`, `term.element`.
- Removed options: `windowsMode`, `fastScrollModifier`.

### @tauri-apps/api 2.12 (JS)

- `import { invoke, Channel } from '@tauri-apps/api/core'`;
  `import { listen } from '@tauri-apps/api/event'`.
- Dialogs: `import { open, save } from '@tauri-apps/plugin-dialog'`;
  `open({ multiple, directory, title, defaultPath }) => string | string[] | null`.
- Opener: `import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener'`.
- Capabilities already granted: `core:default`, `core:window:default`, `opener:default`,
  `dialog:default`.

### tauri-action

- Use `tauri-apps/tauri-action@v1` (v1.0.0 released 2026-06-29).
- Inputs: `tagName`, `releaseName`, `releaseBody`, `releaseDraft`, `prerelease`, `args`,
  `projectPath`, `uploadUpdaterJson` (set `false`: no updater in v1), `retryAttempts`.
- Ubuntu 22.04 deps: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils`
  (plus `build-essential curl wget file libssl-dev libxdo-dev libayatana-appindicator3-dev`).
- macOS: run on `macos-latest` with `--target aarch64-apple-darwin` and
  `--target x86_64-apple-darwin` (install both targets via `dtolnay/rust-toolchain@stable`
  `targets:`). Linux arm64: `ubuntu-22.04-arm` runner (free for public repos).
