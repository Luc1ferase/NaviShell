<div align="center">

<img src="assets/icon.svg" width="96" alt="NaviShell" />

# NaviShell

**一个可插拔的 SSH 终端** · Tauri 2 + React 19 + TypeScript

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

</div>

NaviShell 是一个跨平台 SSH 终端客户端：Rust（Tauri 2）负责连接与传输，React 负责
一套类似 VS Code 的可停靠界面。核心保持精简，**其余能力都以前端插件的形式实现** ——
内置的 SFTP 文件管理器和命令补全本身就是两个插件，使用的 API 与第三方插件完全一致。

## 功能（v1）

- **服务器管理**：分组、标签、颜色标记；密码保存在系统钥匙串（Windows 凭据管理器 /
  macOS 钥匙串 / Linux Secret Service），不写入配置文件。
- **多终端**：基于 xterm.js 的真实 PTY 会话，支持多标签、分屏停靠、布局自动保存恢复。
- **主机密钥校验**：首次连接记录指纹（TOFU），指纹变化时弹窗提示。
- **SFTP 文件管理器**（内置插件）：跟随当前终端的连接，浏览 / 上传 / 下载 / 重命名 /
  删除 / 新建目录，带进度与取消的传输列表，小文件快速编辑。
- **命令补全**（内置插件）：按服务器记录历史命令并从远端 `~/.bash_history`、
  `~/.zsh_history` 预热，结合内置的 275 条常用命令词典（含 git / docker / kubectl /
  systemctl 等子命令），在光标下方给出候选。
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
   Linux x64 + arm64 上分别构建，并把安装包上传到同一个 **草稿（draft）Release**。
4. 人工检查资产后再点击发布。

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

v1 之后计划中的能力（欢迎在对应 issue 下讨论）：

| # | 方向 |
| - | ---- |
| [#1](../../issues/1) | 私钥登录（PEM / OpenSSH、passphrase） |
| [#2](../../issues/2) | ssh-agent 支持 |
| [#3](../../issues/3) | ProxyJump / 跳板机 |
| [#4](../../issues/4) | keyboard-interactive（含 2FA） |
| [#5](../../issues/5) | 应用内自动更新 |
| [#6](../../issues/6) | 本地终端（不经过 SSH） |
| [#7](../../issues/7) | 从 URL 安装插件 |
| [#8](../../issues/8) | 感知远端环境的命令补全（真实补全而非词典） |

## 许可

MIT

---

## English

NaviShell is a cross-platform SSH terminal built with **Tauri 2** (Rust core) and
**React 19 + TypeScript**, with a VS Code-like dockable layout and a frontend plugin system.
The core stays small: the built-in SFTP file manager and command completion are plugins that
use exactly the same public API as third-party ones.

**v1 features** — server records with credentials in the OS keychain, multi-tab PTY terminals
(xterm.js) with persisted dock layout, TOFU host-key verification, an SFTP file manager
(browse, upload, download, rename, delete, transfer progress and cancel), command completion
from per-server history plus a 275-command dictionary, and English / Chinese UI.

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
uploads them to a **draft** release for a human to publish.

**Writing a plugin** — ship a directory with `plugin.json` and a CommonJS `main.js` into
`%APPDATA%\dev.navishell.app\plugins\<id>\` (Windows),
`~/Library/Application Support/dev.navishell.app/plugins/<id>/` (macOS) or
`~/.local/share/dev.navishell.app/plugins/<id>/` (Linux). `react`, `react/jsx-runtime`,
`react-dom`, `react-dom/client`, `@navishell/plugin-api` and `lucide-react` are provided by
the host and must stay external; everything else is bundled. Plugins only ever talk to the
host through `PluginContext` (`panels`, `commands`, `servers`, `connections`, `terminals`,
`storage`, `i18n`, `ui`, `log`) — never through `@tauri-apps/*`. See
`packages/plugin-api/src/index.ts` for the full contract and the two built-in plugins for
worked examples.
