<div align="center">

<img src="assets/icon.svg" width="96" alt="NaviShell" />

# NaviShell

**一个可插拔的 SSH 终端** · Tauri 2 + React 19 + TypeScript

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

</div>

NaviShell 是一个跨平台 SSH 终端客户端：Rust（Tauri 2）负责连接与传输，React 负责
一套类似 VS Code 的可停靠界面。核心保持精简，**其余能力都以前端插件的形式实现** ——
内置的 SFTP 文件管理器和命令补全本身就是两个插件，使用的 API 与第三方插件完全一致。

## 功能

- **服务器管理**：分组、标签、颜色标记；密码与私钥口令保存在系统钥匙串（Windows 凭据
  管理器 / macOS 钥匙串 / Linux Secret Service），不写入配置文件。
- **多种登录方式**：密码、OpenSSH 私钥（加密私钥的口令同样走钥匙串）、ssh-agent；当
  服务器要求 keyboard-interactive（含 2FA / OTP）时，会把每一条提示弹窗问用户。
- **跳板机（ProxyJump）**：服务器记录里挂一个 `jumpServerId`，先连跳板机，再把目标会话
  通过它的 direct-tcpip 通道隧穿过去；跳板机断开时，经由它的连接一起关闭。
- **多终端**：基于 xterm.js 的真实 PTY 会话，支持多标签、分屏停靠、布局自动保存恢复。
- **本地终端**：不经过 SSH，直接在本机开一个 shell。默认程序为 Windows 上的 `pwsh.exe`
  （没装则 `powershell.exe`）、其他平台的 `$SHELL`（未设置则 `/bin/bash`），可在设置的
  「本地 shell」里改成任意程序与参数。
- **主机密钥校验**：首次连接记录指纹（TOFU），指纹变化时弹窗提示。
- **SFTP 文件管理器**（内置插件）：跟随当前终端的连接（本地终端没有连接，会退回到连接
  下拉框），浏览 / 上传 / 下载 / 重命名 / 删除 / 新建目录，带进度与取消的传输列表，
  小文件快速编辑。
- **命令补全**（内置插件）：按服务器记录历史命令（本地终端统一归到 `local`）并从远端
  `~/.bash_history`、`~/.zsh_history` 预热；补全远端 `PATH` 上的可执行文件
  （`compgen -c`）和远端目录里的路径；再结合内置的 275 条常用命令词典（含 git /
  docker / kubectl / systemctl 等子命令），在光标下方给出候选并标注来源。
  路径补全依赖 shell 上报的当前目录（OSC 7）；可选的 **shell 集成** 开关（默认关闭，
  命令面板里的「开启/关闭 shell 集成」）会给新建的 SSH 终端注入一行
  `PROMPT_COMMAND` / `precmd` 钩子，让 bash 与 zsh 在每个提示符后上报目录。
- **插件安装**：除了手动把目录丢进插件目录，也可以在「设置 → 插件」里从 zip 的 URL
  （可选填 SHA-256 校验）或本地 zip 文件安装，并就地卸载，装完无需重启。
- **应用内更新**：启动后（可在设置里关闭）以及「设置 → 关于」里检查最新 GitHub
  Release，确认后下载、安装并重启；安装包都带 minisign 签名，签名不匹配一律拒绝。
- **中英双语**：界面语言跟随系统，可手动切换；插件可注册自己的翻译资源。
- **深色优先的主题**：所有颜色来自一组 CSS 变量，插件复用同一套变量。

## 截图

> 待补充：主界面（终端 + 服务器列表 + SFTP 面板）、命令补全弹窗、设置页。
>
> ```
> docs/screenshots/main.png
> docs/screenshots/completion.png
> docs/screenshots/settings.png
> ```

## 架构

设计说明、IPC 契约、插件契约与目录结构都在 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**；
依赖版本相关的已验证事实记录在 [docs/DEPENDENCY-NOTES.md](docs/DEPENDENCY-NOTES.md)。

两份契约文件是单一事实来源：

| 契约 | 文件 |
| ---- | ---- |
| 前端 ↔ Rust 的 IPC | `src/core/ipc/contract.ts` |
| 宿主 ↔ 插件 | `packages/plugin-api/src/index.ts` |

## 开发

需要 Node 22+、pnpm 11+ 和 Rust stable 工具链（以及各平台的 Tauri 系统依赖）。

```bash
pnpm install          # 安装依赖
pnpm dev              # 前端开发服务器
pnpm tauri dev        # 连同 Rust 核心一起运行桌面应用

pnpm typecheck        # 全仓库 tsc --noEmit（含两个插件包）
pnpm lint             # eslint
pnpm build            # 构建插件 bundle + 前端 dist/
pnpm build:plugins    # 只构建内置插件到 public/plugins/<id>/
pnpm format           # prettier --write
```

Rust 侧：

```bash
cd src-tauri
cargo fmt --all
cargo clippy --all-targets -- -D warnings
cargo check
```

> `tauri::generate_context!()` 在编译期需要 `dist/` 存在，所以执行 `cargo check` 之前
> 先跑一次 `pnpm build`（CI 里也是这么做的）。

### 发版

本地不做打包，安装包一律由 GitHub Actions 产出：

1. 同步修改三处版本号：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。
2. 提交后打 tag 并推送：

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. `.github/workflows/release.yml` 会在 Windows x64、macOS（Intel + Apple Silicon）、
   Linux x64 + arm64 上分别构建，并把安装包、每个安装包的 `.sig` 签名以及更新清单
   `latest.json` 上传到同一个 **草稿（draft）Release**。
4. 人工检查资产后再点击发布。**必须真正发布（而不是留在草稿、也不要勾选 pre-release）**，
   否则自动更新看不到它：客户端读取的地址是
   `releases/latest/download/latest.json`，而 GitHub 的 `latest` 只会指向已发布且非
   pre-release 的 Release。

更新签名需要两个仓库 Secret，缺一个构建就会失败：

| Secret | 内容 |
| ------ | ---- |
| `TAURI_SIGNING_PRIVATE_KEY` | `pnpm tauri signer generate` 生成的 minisign 私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时设置的私钥密码 |

私钥的公钥部分写在 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 里。**换
密钥对就等于放弃所有已安装的旧版本**：老客户端只信任自己编译进去的那个公钥，只能让用户
手动重装，所以私钥要单独备份好。

每次 push 到 `master` 和每个 PR 都会触发 `.github/workflows/ci.yml`：前端类型检查、
lint、构建，以及三大平台的 `cargo fmt` / `clippy` / `cargo check`。

## 插件开发

插件是一个目录，包含清单 `plugin.json` 和一个 CommonJS bundle（默认 `main.js`）。

### 安装位置

把插件目录放到下面的位置，重启应用即可被识别（目录名建议与插件 id 一致）：

| 平台 | 路径 |
| ---- | ---- |
| Windows | `%APPDATA%\dev.navishell.app\plugins\<id>\` |
| macOS | `~/Library/Application Support/dev.navishell.app/plugins/<id>/` |
| Linux | `~/.local/share/dev.navishell.app/plugins/<id>/` |

也可以在「设置 → 插件」里直接从 zip 安装，省掉手动复制：

- 分发的 zip 里，`plugin.json` 放在压缩包根目录，或者放在**唯一**一个顶层目录下
  （`git archive` 和 GitHub 的「Download ZIP」就是后一种形状）。
- `plugin.json` 的 `id` 必须符合 `^[a-z0-9][a-z0-9._-]*$`，且不能以 `navishell.`
  开头（那是内置插件的前缀）；`main` 指向的文件必须真的在包里。
- 压缩包上限 50 MiB，下载超时 60 秒，只接受 http / https。可以填一个 SHA-256
  （十六进制，大小写都行）让核心在解压前校验下载内容。
- 带绝对路径、`..`、Windows 盘符前缀的条目会被拒绝，符号链接条目直接跳过。
- id 已经装过时需要确认覆盖；覆盖是整目录替换，旧目录先挪到暂存区，替换失败会放回去。
- 卸载会同时删掉该插件的存储文件 `plugin-data/<id>.json`。

### 清单 `plugin.json`

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

| 字段 | 说明 |
| ---- | ---- |
| `id` | 唯一标识，小写，点 / 短横线分隔；内置插件使用 `navishell.<name>` |
| `name` / `description` | 字符串，或 `{ "en": …, "zh-CN": … }` 的多语言映射 |
| `version` | 插件版本 |
| `main` | CommonJS 入口，相对插件目录，默认 `main.js` |
| `styles` | 激活时注入文档的 CSS 文件列表 |
| `icon` | [lucide-react](https://lucide.dev/icons/) 图标名 |
| `minHostVersion` | 支持的最低宿主版本 |

### 打包格式

宿主用 `new Function('module', 'exports', 'require', code)` 执行 `main.js`，
`module.exports`（或 `module.exports.default`）必须是插件对象。注入的 `require`
**只**解析下面这些宿主模块，它们不能被打进 bundle：

```
react          react/jsx-runtime      react-dom      react-dom/client
@navishell/plugin-api                 lucide-react
```

其余依赖必须自行打包。仓库内置插件的 Vite 配置可以直接照抄：
[`scripts/plugin-vite.mjs`](scripts/plugin-vite.mjs)（输出 CJS、单文件、externals 已配好）。

### `PluginContext` 一览

`activate(ctx)` 拿到的 `ctx` 是插件能接触到的全部能力，**不要直接调用 `@tauri-apps/*`**：

| 命名空间 | 能做什么 |
| -------- | -------- |
| `ctx.panels` | 注册 / 打开 / 关闭可停靠面板（`register`、`open`、`toggle`） |
| `ctx.commands` | 注册命令、执行任意命令（`<pluginId>:<id>`） |
| `ctx.servers` | 服务器列表、连接、打开终端 |
| `ctx.connections` | 连接列表、一次性 `exec`、`sftp(connectionId)`、断开 |
| `ctx.terminals` | 终端句柄、输入/输出事件、覆盖层组件、按键拦截 |
| `ctx.storage` | 插件私有的持久化 KV（`<appData>/plugin-data/<pluginId>.json`） |
| `ctx.i18n` | 注册翻译资源、`t()`、当前语言与语言变更事件 |
| `ctx.ui` | toast、确认框、输入框、文件选择、保存对话框、右键菜单 |
| `ctx.log` | 写入应用日志 |
| `ctx.subscriptions` | 放进去的 `Disposable` 会在插件停用时自动释放 |

### 最小示例

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
    // ctx.subscriptions 已自动释放，这里只处理自己的资源
  },
});
```

把它构建成 `main.js` + `style.css`，和 `plugin.json` 一起放进上面的插件目录即可。
完整示例可以直接读 [`packages/plugin-sftp`](packages/plugin-sftp) 和
[`packages/plugin-completion`](packages/plugin-completion)。

## 路线图

v1 之后的方向（欢迎在对应 issue 下讨论）。标为「下个版本」的已经在 `master` 上实现，
会随下一个 Release 发布：

| # | 方向 | 状态 |
| - | ---- | ---- |
| [#1](../../issues/1) | 私钥登录（PEM / OpenSSH、passphrase） | 下个版本 |
| [#2](../../issues/2) | ssh-agent 支持 | 下个版本 |
| [#3](../../issues/3) | ProxyJump / 跳板机 | 下个版本 |
| [#4](../../issues/4) | keyboard-interactive（含 2FA） | 下个版本 |
| [#5](../../issues/5) | 应用内自动更新 | 下个版本 |
| [#6](../../issues/6) | 本地终端（不经过 SSH） | 下个版本 |
| [#7](../../issues/7) | 从 URL 安装插件 | 下个版本 |
| [#8](../../issues/8) | 感知远端环境的命令补全（真实补全而非词典） | 下个版本 |

插件市场（#7 里提到的注册表索引 JSON）还没做，目前只能自己给 URL。

## 许可

MIT

---

## English

NaviShell is a cross-platform SSH terminal built with **Tauri 2** (Rust core) and
**React 19 + TypeScript**, with a VS Code-like dockable layout and a frontend plugin system.
The core stays small: the built-in SFTP file manager and command completion are plugins that
use exactly the same public API as third-party ones.

**Features** — server records with credentials in the OS keychain; password, private-key and
ssh-agent authentication with a keyboard-interactive fallback for 2FA; ProxyJump through a
saved jump host; multi-tab PTY terminals (xterm.js) with a persisted dock layout; local shell
terminals that skip SSH entirely (`pwsh.exe`/`powershell.exe` on Windows, `$SHELL` elsewhere,
both overridable in the settings); TOFU host-key verification; an SFTP file manager (browse,
upload, download, rename, delete, transfer progress and cancel); command completion from
history, the remote `PATH`, remote directory listings and a 275-command dictionary, with an
opt-in shell-integration toggle that teaches bash and zsh to report their working directory
through OSC 7; plugin installation from a zip URL or a local zip file (with an optional
SHA-256 check) and uninstallation, both without a restart; in-app updates against the
latest GitHub Release, signed with minisign; and an English / Chinese UI.

**Development**

```bash
pnpm install
pnpm typecheck        # tsc across the app and both plugin packages
pnpm lint
pnpm build            # plugin bundles + dist/
cd src-tauri && cargo check    # needs dist/ to exist first
```

Nothing is packaged locally. To release, bump the version in `package.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then push a `vX.Y.Z` tag: GitHub
Actions builds Windows x64, macOS (Intel + Apple silicon) and Linux x64 + arm64 bundles and
uploads them, their `.sig` signatures and `latest.json` to a **draft** release for a human
to publish. Signing needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (`pnpm tauri signer generate`); the matching public
key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. The draft has to be
published and not flagged as a prerelease, because the updater reads
`releases/latest/download/latest.json` and GitHub's `latest` skips both.

**Writing a plugin** — ship a directory with `plugin.json` and a CommonJS `main.js` into
`%APPDATA%\dev.navishell.app\plugins\<id>\` (Windows),
`~/Library/Application Support/dev.navishell.app/plugins/<id>/` (macOS) or
`~/.local/share/dev.navishell.app/plugins/<id>/` (Linux), or zip it up and point Settings
> Plugins at the file or at an http(s) URL. In a zip, `plugin.json` goes at the root or
inside a single top-level directory; the archive may not exceed 50 MiB, and entries with
absolute paths or `..` are rejected. `react`, `react/jsx-runtime`,
`react-dom`, `react-dom/client`, `@navishell/plugin-api` and `lucide-react` are provided by
the host and must stay external; everything else is bundled. Plugins only ever talk to the
host through `PluginContext` (`panels`, `commands`, `servers`, `connections`, `terminals`,
`storage`, `i18n`, `ui`, `log`) — never through `@tauri-apps/*`. See
`packages/plugin-api/src/index.ts` for the full contract and the two built-in plugins for
worked examples.
