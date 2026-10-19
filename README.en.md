<div align="center">

<img src="assets/icon.svg" width="96" alt="NaviShell" />

# NaviShell

**A pluggable SSH terminal** · Tauri 2 + React 19 + TypeScript

[简体中文](README.md) | English | [日本語](README.ja.md)

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

</div>

NaviShell is a cross-platform SSH terminal client. Rust (Tauri 2) owns connections and
transfers; React renders a VS Code-like dockable UI. The core stays small and **everything
else is a frontend plugin**: the built-in SFTP file manager and command completion are two
plugins that use exactly the same API as third-party ones.

## Features

- **Server management**: groups, tags and colour markers. Passwords and private-key
  passphrases live in the OS keychain (Windows Credential Manager / macOS Keychain / Linux
  Secret Service), never in a config file.
- **Several login methods**: password, OpenSSH private key (an encrypted key's passphrase
  also goes to the keychain) and ssh-agent. When a server requires keyboard-interactive
  (including 2FA / OTP), every prompt is shown to the user in a dialog.
- **Jump hosts (ProxyJump)**: attach a `jumpServerId` to a server record; NaviShell connects
  to the jump host first and tunnels the target session through a direct-tcpip channel.
  Closing the jump connection closes everything tunnelled through it.
- **Multiple terminals**: real PTY sessions on xterm.js with tabs, split docking and a
  layout that is saved and restored automatically.
- **Local terminals**: open a shell on this machine without SSH. The default program is
  `pwsh.exe` on Windows (`powershell.exe` when it is missing) and `$SHELL` elsewhere
  (`/bin/bash` when unset); Settings → Local shell accepts any program and arguments.
- **Host-key verification**: the fingerprint is recorded on first contact (TOFU) and a
  changed fingerprint raises a dialog.
- **SFTP file manager** (built-in plugin): follows the active terminal's connection (local
  terminals have none, so it falls back to a connection dropdown); browse / upload /
  download / rename / delete / new folder, a transfer list with progress and cancel, and
  quick editing of small files.
- **Command completion** (built-in plugin): records command history per server (local
  terminals share the `local` key) and seeds it from the remote `~/.bash_history` and
  `~/.zsh_history`; completes executables on the remote `PATH` (`compgen -c`) and paths in
  remote directories; adds a built-in dictionary of 275 common commands (with git / docker /
  kubectl / systemctl subcommands) and shows the candidates under the cursor with their
  source. Path completion relies on the shell reporting its working directory (OSC 7); the
  optional **shell integration** toggle (off by default, "Enable/disable shell integration"
  in the command list) injects a one-line `PROMPT_COMMAND` / `precmd` hook into new SSH
  terminals so bash and zsh report the directory after every prompt.
- **Plugin installation**: besides dropping a directory into the plugins folder, Settings →
  Plugins installs from a zip URL (with an optional SHA-256 check) or a local zip file and
  uninstalls in place, all without a restart.
- **In-app updates**: after startup (can be disabled in Settings) and from Settings → About,
  NaviShell checks the latest GitHub Release and, once confirmed, downloads, installs and
  restarts. Every bundle carries a minisign signature; a mismatch is always rejected.
- **English / Chinese UI**: follows the system language and can be switched manually;
  plugins register their own translations.
- **Dark-first theme**: every colour comes from one set of CSS variables that plugins reuse.

## Screenshots

> To be added: main window (terminal + server list + SFTP panel), the completion popup and
> the settings page.
>
> ```
> docs/screenshots/main.png
> docs/screenshots/completion.png
> docs/screenshots/settings.png
> ```

## Architecture

Design notes, the IPC contract, the plugin contract and the directory layout are in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**; verified facts about dependency versions
are recorded in [docs/DEPENDENCY-NOTES.md](docs/DEPENDENCY-NOTES.md).

Two contract files are the single source of truth:

| Contract | File |
| -------- | ---- |
| Frontend ↔ Rust IPC | `src/core/ipc/contract.ts` |
| Host ↔ plugins | `packages/plugin-api/src/index.ts` |

## Development

Requires Node 22+, pnpm 11+ and a stable Rust toolchain (plus the Tauri system
dependencies of your platform).

```bash
pnpm install          # install dependencies
pnpm dev              # frontend dev server
pnpm tauri dev        # run the desktop app together with the Rust core

pnpm typecheck        # tsc --noEmit across the repo (both plugin packages included)
pnpm lint             # eslint
pnpm build            # build the plugin bundles + the frontend dist/
pnpm build:plugins    # only the built-in plugins, into public/plugins/<id>/
pnpm format           # prettier --write
```

Rust side:

```bash
cd src-tauri
cargo fmt --all
cargo clippy --all-targets -- -D warnings
cargo check
```

> `tauri::generate_context!()` needs `dist/` to exist at compile time, so run `pnpm build`
> once before `cargo check` (CI does the same).

### Releasing

Nothing is packaged locally; installers always come from GitHub Actions:

1. Bump the version in all three places: `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`.
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```

3. `.github/workflows/release.yml` builds on Windows x64, macOS (Intel + Apple Silicon) and
   Linux x64 + arm64, and uploads the installers, each installer's `.sig` signature and the
   update manifest `latest.json` to one **draft** release.
4. Review the assets, then publish. **The release must really be published (not left as a
   draft, not flagged as a pre-release)**, otherwise the updater never sees it: clients read
   `releases/latest/download/latest.json`, and GitHub's `latest` only points at published,
   non-pre-release releases.

Signing updates needs two repository secrets; the build fails if either is missing:

| Secret | Content |
| ------ | ------- |
| `TAURI_SIGNING_PRIVATE_KEY` | the minisign private key generated by `pnpm tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password chosen when generating it |

The public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. **Rotating the
key pair abandons every installed build**: old clients only trust the public key compiled
into them and would have to be reinstalled by hand, so keep the private key backed up.

Every push to `master` and every pull request runs `.github/workflows/ci.yml`: frontend
type check, lint and build, plus `cargo fmt` / `clippy` / `cargo check` on all three
desktop platforms.

## Writing plugins

A plugin is a directory containing the manifest `plugin.json` and one CommonJS bundle
(`main.js` by default).

### Install location

Put the plugin directory here and restart the app (name the directory after the plugin id):

| Platform | Path |
| -------- | ---- |
| Windows | `%APPDATA%\dev.navishell.app\plugins\<id>\` |
| macOS | `~/Library/Application Support/dev.navishell.app/plugins/<id>/` |
| Linux | `~/.local/share/dev.navishell.app/plugins/<id>/` |

Settings → Plugins can also install straight from a zip, skipping the manual copy:

- In the distributed zip, `plugin.json` sits at the archive root or inside a **single**
  top-level directory (`git archive` and GitHub's "Download ZIP" produce the latter).
- The manifest `id` must match `^[a-z0-9][a-z0-9._-]*$` and must not start with
  `navishell.` (reserved for built-ins); the file named by `main` must exist in the archive.
- Archives are capped at 50 MiB, downloads time out after 60 s and only http / https are
  accepted. An optional SHA-256 (hex, any case) is verified before unpacking.
- Entries with absolute paths, `..` or Windows drive prefixes are rejected; symlink entries
  are skipped.
- Installing an id that already exists asks for confirmation; replacing swaps the whole
  directory, moving the old one aside first and restoring it if the swap fails.
- Uninstalling also removes the plugin's storage file `plugin-data/<id>.json`.

### Manifest `plugin.json`

```json
{
  "id": "acme.hello",
  "name": { "en": "Hello", "zh-CN": "你好" },
  "version": "0.1.0",
  "description": { "en": "A tiny example panel.", "zh-CN": "一个示例面板。" },
  "author": "Acme",
  "homepage": "https://example.com",
  "main": "main.js",
  "styles": ["style.css"],
  "icon": "Sparkles",
  "minHostVersion": "0.1.0"
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | unique, lowercase, dot / dash separated; built-ins use `navishell.<name>` |
| `name` / `description` | a string or a locale map `{ "en": …, "zh-CN": … }` |
| `version` | plugin version |
| `main` | CommonJS entry relative to the plugin directory, default `main.js` |
| `styles` | CSS files injected into the document on activation |
| `icon` | a [lucide-react](https://lucide.dev/icons/) icon name |
| `minHostVersion` | lowest supported host version |

### Bundle format

The host runs `main.js` with `new Function('module', 'exports', 'require', code)`;
`module.exports` (or `module.exports.default`) must be the plugin object. The injected
`require` resolves **only** the host modules below, which must not be bundled:

```
react          react/jsx-runtime      react-dom      react-dom/client
@navishell/plugin-api                 lucide-react
```

Everything else has to be bundled. The Vite config of the built-in plugins can be copied
as is: [`scripts/plugin-vite.mjs`](scripts/plugin-vite.mjs) (CJS output, single file,
externals already configured).

### `PluginContext` at a glance

The `ctx` passed to `activate(ctx)` is everything a plugin can touch. **Never call
`@tauri-apps/*` directly.**

| Namespace | What it offers |
| --------- | -------------- |
| `ctx.panels` | register / open / close dockable panels (`register`, `open`, `toggle`) |
| `ctx.commands` | register commands, execute any command (`<pluginId>:<id>`) |
| `ctx.servers` | server list, connect, open a terminal |
| `ctx.connections` | connection list, one-shot `exec`, `sftp(connectionId)`, disconnect |
| `ctx.terminals` | terminal handles, input/output events, overlay components, key interception |
| `ctx.storage` | private persistent key/value store (`<appData>/plugin-data/<pluginId>.json`) |
| `ctx.i18n` | register translations, `t()`, current locale and locale-change events |
| `ctx.ui` | toasts, confirm and prompt dialogs, file and save pickers, context menus |
| `ctx.log` | write to the application log |
| `ctx.subscriptions` | `Disposable`s pushed here are released automatically on deactivation |

### Minimal example

```tsx
// src/index.tsx
import { definePlugin } from '@navishell/plugin-api';
import type { PanelProps, PluginContext } from '@navishell/plugin-api';

function HelloPanel({ ctx }: PanelProps) {
  const connections = ctx.connections.list();
  return (
    <div style={{ padding: 12, color: 'var(--ns-fg)', fontFamily: 'var(--ns-font-ui)' }}>
      <p>{ctx.i18n.t('panel.greeting')}</p>
      <p>{connections.length} connection(s)</p>
      <button onClick={() => ctx.ui.toast('Hello from a plugin!', 'success')}>Toast</button>
    </div>
  );
}

export default definePlugin({
  activate(ctx: PluginContext) {
    ctx.i18n.addResources('en', { 'panel.title': 'Hello', 'panel.greeting': 'Hi there' });
    ctx.i18n.addResources('zh-CN', { 'panel.title': '你好', 'panel.greeting': '你好呀' });

    ctx.subscriptions.push(
      ctx.panels.register({
        id: 'hello',
        title: 'panel.title',
        icon: 'Sparkles',
        component: HelloPanel,
        defaultPosition: 'right',
        defaultOpen: true,
      }),
    );
  },
  deactivate() {
    // ctx.subscriptions is released automatically; only clean up your own resources here
  },
});
```

Build it into `main.js` + `style.css` and put them next to `plugin.json` in the plugin
directory above. For complete examples read [`packages/plugin-sftp`](packages/plugin-sftp)
and [`packages/plugin-completion`](packages/plugin-completion).

## Roadmap

Directions planned after v1 and their status (discuss in the linked issues):

| # | Direction | Status |
| - | --------- | ------ |
| [#1](../../issues/1) | Private-key login (PEM / OpenSSH, passphrase) | shipped in 0.2.0 |
| [#2](../../issues/2) | ssh-agent support | shipped in 0.2.0 |
| [#3](../../issues/3) | ProxyJump / jump hosts | shipped in 0.2.0 |
| [#4](../../issues/4) | keyboard-interactive (including 2FA) | shipped in 0.2.0 |
| [#5](../../issues/5) | In-app auto update | shipped in 0.2.0 |
| [#6](../../issues/6) | Local terminals (no SSH) | shipped in 0.2.0 |
| [#7](../../issues/7) | Install plugins from a URL | shipped in 0.2.0 |
| [#8](../../issues/8) | Remote-aware command completion (real completion, not a dictionary) | shipped in 0.2.0 |

A plugin marketplace (the registry index JSON mentioned in #7) is not built yet; for now
you supply the URL yourself.

## License

MIT
