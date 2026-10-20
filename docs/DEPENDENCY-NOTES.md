# Dependency notes (verified against docs on 2026-10-18, updated 2026-10-19)

Versions pinned in this repo are newer than most training data. These notes record the
API facts that were verified from docs.rs / official docs so nobody has to guess.

## Tauri plugin version pairing

**A `tauri-plugin-*` crate must be on the same minor as its `@tauri-apps/plugin-*` npm
package.** The two halves of a plugin share one IPC surface and are released together, so
a mismatch shows up at runtime as "command not found" or a deserialisation failure, not at
compile time. Current pairs:

| npm package                    | version | crate                  | version |
| ------------------------------ | ------- | ---------------------- | ------- |
| `@tauri-apps/plugin-opener`    | 2.7     | `tauri-plugin-opener`  | 2.7     |
| `@tauri-apps/plugin-dialog`    | 2.8     | `tauri-plugin-dialog`  | 2.8     |
| `@tauri-apps/plugin-updater`   | 2.14    | `tauri-plugin-updater` | 2.14    |
| `@tauri-apps/plugin-process`   | 2.4     | `tauri-plugin-process` | 2.4     |

Bumping one side means bumping the other in the same commit. `3.0.0-alpha.*` of these
crates exists on crates.io and is what `cargo add` / `cargo info` resolve to by default —
do not take it.

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

### tauri-plugin-updater 2.14 + tauri-plugin-process 2.4

```rust
// Desktop only; both are no-ops to register on mobile and have no mobile permissions.
#[cfg(desktop)]
let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())   // TauriPlugin<R, Config>
    .plugin(tauri_plugin_process::init());                  // TauriPlugin<R>
```

- Config comes from `plugins.updater` in `tauri.conf.json`: `pubkey` (the minisign public
  key, base64 of the whole `.pub` file), `endpoints` (array of URLs; `{{target}}`,
  `{{arch}}`, `{{current_version}}` and `{{bundle_type}}` are substituted),
  `windows.installMode` (`"passive"` default, `"basicUi"`, `"quiet"`), plus
  `requireSignedVersion`, `allowDowngrades` and three `dangerous*` escape hatches.
- Capability permissions: `updater:default` = `allow-check`, `allow-download`,
  `allow-install`, `allow-download-and-install`. `process:default` = `allow-exit`,
  `allow-restart`. Both are in `capabilities/default.json`.
- Default crate features are `rustls-tls` + `system-proxy` + `zip`. `rustls-tls` means
  `reqwest/rustls-no-provider` plus `rustls` with the **`ring`** provider, so no
  `aws-lc-rs` and therefore no NASM on Windows — keep it that way.
- `bundle.createUpdaterArtifacts: true` makes `tauri build` emit the signed
  `*.sig` next to each bundle; the build then *requires* `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the environment.

### reqwest 0.13

The feature names changed from 0.12 and there is no `rustls-tls` any more:

| want                             | feature              |
| -------------------------------- | -------------------- |
| rustls with the aws-lc-rs backend | `rustls`             |
| rustls, caller installs the provider | `rustls-no-provider` |
| `Response::bytes_stream()`        | `stream`             |

`default` is `default-tls` + `charset` + `http2` + `system-proxy`, and `default-tls` is
`rustls` — i.e. **the default pulls in aws-lc-rs**, which needs NASM and a C compiler on
Windows. This repo therefore uses `default-features = false` with `rustls-no-provider`
and installs the provider itself, exactly as `tauri-plugin-updater` does:

```rust
if rustls::crypto::CryptoProvider::get_default().is_none() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}
```

With `__rustls` on and `__native-tls` off, `TlsBackend::default()` is rustls, so a plain
`Client::builder()` already speaks https; `use_rustls_tls()` is not needed.
`ClientBuilder::{timeout, read_timeout, connect_timeout, user_agent}` are unchanged.
`Response::chunk() -> Result<Option<Bytes>>` streams a body without the `stream` feature
(`bytes_stream()` is the one that needs it). `reqwest::Url` is re-exported, so URL
parsing needs no separate `url` dependency. `tauri` itself depends on reqwest 0.13, so
staying on that major adds no second copy.

### zip 9 (zip-rs/zip2)

Reading is blocking, so call it from `spawn_blocking`.

```rust
let mut zip = zip::ZipArchive::new(BufReader::new(File::open(path)?))?;  // ZipResult
for i in 0..zip.len() {
    let mut entry = zip.by_index(i)?;              // ZipFile<'_, R>: Read
    entry.name()      -> ZipResult<Cow<'_, str>>   // NOT &str as in 0.6/1.x
    entry.name_raw()  -> &[u8]
    entry.enclosed_name() -> Option<PathBuf>       // None = unsafe name
    entry.is_dir(); entry.is_symlink(); entry.is_file(); entry.size(); entry.unix_mode();
}
```

`enclosed_name()` is the whole path-traversal defence in one call: entry names are parsed
as Windows paths on *every* host, so it rejects `..` that escapes, absolute paths, drive
and UNC prefixes, verbatim (`\\?\`) prefixes and components containing a separator.
Symlink entries still need handling separately (this repo skips them) because the danger
is in their *target*, not their name.

Features: `default` is a large set including compressors. For reading deflate archives,
`default-features = false, features = ["deflate-flate2"]` is enough and keeps the
pure-Rust `miniz_oxide` backend; the `deflate` feature additionally pulls in the zopfli
compressor and `zlib-rs`. `ZipError` variants: `Io`, `InvalidArchive(Cow<'static, str>)`,
`UnsupportedArchive(&'static str)`, `FileNotFound`, `InvalidPassword`,
`CompressionMethodNotSupported(u16)`.

### sha2 0.10

`use sha2::{Digest, Sha256};` then `let mut h = Sha256::new(); h.update(bytes);
h.finalize()` (a `GenericArray<u8, U32>`). 0.11 is out but is a different `digest` major;
0.10 is what the rest of the tree already uses. There is no `hex` crate in this repo —
`write!(s, "{byte:02x}")` over the digest is the formatting used by `plugins.rs`.

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

### marked 18 + dompurify 3.4 (Markdown in the Extensions panel)

- `marked.parse(src, { gfm: true, async: false })` returns a `string`; the `async: false`
  literal is what narrows the overload (without it the type is `string | Promise<string>`).
  The old `baseUrl` and `sanitize` options are gone (removed in v5 / v8), so resolving
  relative URLs and sanitising are our own job (`src/core/plugins/markdown.ts`).
- DOMPurify is a default export (`import DOMPurify from 'dompurify'`) with bundled types.
  `addHook('uponSanitizeAttribute', (node, data) => …)` runs *before* the attribute is
  validated and `data.attrValue` is mutable, so rewriting a relative `href` / `src` to an
  absolute one there lets `ALLOWED_URI_REGEXP` judge the final value. `USE_PROFILES:
  { html: true }` keeps SVG and MathML out; `FORBID_TAGS` / `FORBID_ATTR` apply on top of
  the profile. Licence: MPL-2.0 OR Apache-2.0 (we take Apache-2.0); marked is MIT.

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
  `projectPath`, `retryAttempts`, `uploadUpdaterJson` (default `true`; generates and
  uploads `latest.json` from the signed bundles), `updaterJsonPreferNsis` (default
  `false`; set it so the Windows entry points at the NSIS `setup.exe` rather than the
  `.msi`).
- Signing secrets go in the step's `env`, not its `with`: `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- `latest.json` is uploaded as a release asset, so the URL in `plugins.updater.endpoints`
  only resolves once the release is **published** and not flagged as a prerelease —
  `releases/latest/download/…` skips drafts and prereleases.
- Ubuntu 22.04 deps: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils`
  (plus `build-essential curl wget file libssl-dev libxdo-dev libayatana-appindicator3-dev`).
- macOS: run on `macos-latest` with `--target aarch64-apple-darwin` and
  `--target x86_64-apple-darwin` (install both targets via `dtolnay/rust-toolchain@stable`
  `targets:`). Linux arm64: `ubuntu-22.04-arm` runner (free for public repos).
