<div align="center">

<img src="assets/icon.svg" width="96" alt="NaviShell" />

# NaviShell

**一個可外掛擴充的 SSH 終端機** · Tauri 2 + React 19 + TypeScript

[简体中文](README.md) | 繁體中文 | [English](README.en.md) | [日本語](README.ja.md)

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

</div>

NaviShell 是一個跨平台的 SSH 終端機用戶端：Rust（Tauri 2）負責連線與傳輸，React 負責
一套類似 VS Code 的可停駐介面。核心保持精簡，**其餘功能都以前端外掛的形式實作** ——
內建的 SFTP 檔案管理員和指令自動完成本身就是兩個外掛，使用的 API 與第三方外掛完全一致。

## 功能

- **伺服器管理**：分組、標籤、顏色標記；密碼與私密金鑰的密碼片語存放在系統鑰匙圈
  （Windows 認證管理員 / macOS 鑰匙圈 / Linux Secret Service），不寫入設定檔。
- **多種登入方式**：密碼、OpenSSH 私密金鑰（加密金鑰的密碼片語同樣走鑰匙圈）、ssh-agent；
  當伺服器要求 keyboard-interactive（含 2FA / OTP）時，會把每一條提示以對話方塊詢問使用者。
- **跳板主機（ProxyJump）**：在伺服器記錄裡掛一個 `jumpServerId`，先連上跳板主機，再把目標
  工作階段透過它的 direct-tcpip 通道穿隧過去；跳板主機中斷連線時，經由它的連線一併關閉。
- **多終端機**：基於 xterm.js 的真實 PTY 工作階段，支援多分頁、分割停駐、版面配置自動儲存
  與還原。
- **本機終端機**：不經過 SSH，直接在本機開一個 shell。預設程式為 Windows 上的 `pwsh.exe`
  （沒裝則 `powershell.exe`）、其他平台的 `$SHELL`（未設定則 `/bin/bash`），可在設定的
  「本機 shell」裡改成任意程式與參數。
- **主機金鑰驗證**：首次連線記錄指紋（TOFU），指紋變更時跳出提示。
- **SFTP 檔案管理員**（內建外掛）：跟隨目前終端機的連線（本機終端機沒有連線，會退回到連線
  下拉選單），瀏覽 / 上傳 / 下載 / 重新命名 / 刪除 / 新增目錄，附進度與取消的傳輸清單，
  小檔案可快速編輯。
- **指令自動完成**（內建外掛）：依伺服器記錄歷史指令（本機終端機統一歸到 `local`）並從遠端
  `~/.bash_history`、`~/.zsh_history` 預先載入；自動完成遠端 `PATH` 上的執行檔
  （`compgen -c`）和遠端目錄裡的路徑；再結合內建的 275 條常用指令字典（含 git /
  docker / kubectl / systemctl 等子指令），在游標下方列出候選並標註來源。
  路徑自動完成依賴 shell 回報的目前目錄（OSC 7）；選用的 **shell 整合** 開關（預設關閉，
  指令面板裡的「啟用/停用 shell 整合」）會為新建的 SSH 終端機注入一行
  `PROMPT_COMMAND` / `precmd` 掛鉤，讓 bash 與 zsh 在每個提示符號後回報目錄。
  彈出視窗不會擋住輸入：Enter 始終依原樣執行已輸入的指令，Tab / → 採用反白的候選，只有用
  ↑↓ 明確選取某一項之後，Enter 才會改為採用它。
- **外掛安裝**：除了手動把目錄放進外掛目錄，也可以在「設定 → 外掛」裡從 zip 的 URL
  （可選填 SHA-256 檢查碼）或本機 zip 檔安裝，並就地解除安裝，裝完不必重新啟動；**外掛市集**
  會列出一份索引裡的外掛，一鍵安裝。
- **應用程式內更新**：啟動後（可在設定裡關閉）以及「設定 → 關於」裡檢查最新的 GitHub
  Release，確認後下載、安裝並重新啟動；安裝包都帶 minisign 簽章，簽章不符一律拒絕。
- **多語言介面**：簡體中文和 English 內建；日本語、繁體中文以**語言套件外掛**的形式隨應用程式
  附帶（和 VS Code 的語言套件一樣，可在「設定 → 外掛」裡停用）。介面語言跟隨系統或手動
  切換。任何外掛都能透過 `ctx.i18n.registerLocale` 貢獻一種新語言，連帶翻譯其他外掛的
  字串；一般外掛用 `addResources` 註冊自己的翻譯。
- **深色 / 淺色主題與終端機配色分開**：介面主題只有深色、淺色、跟隨系統三種，所有顏色來自
  一組 CSS 變數，外掛重複使用同一套。終端機配色另選：內建 16 套常見方案（One Half、Dracula、
  Nord、Gruvbox、Solarized、Catppuccin、Monokai、Campbell 等），深色介面和淺色介面各記一套，
  淺色介面裡也可以用深色終端機；預設啟用 4.5 : 1 的最低對比度（與 VS Code 一致），和背景過於
  接近的文字會被自動調整。

## 螢幕截圖

> 待補充：主畫面（終端機 + 伺服器清單 + SFTP 面板）、指令自動完成彈出視窗、設定頁。
>
> ```
> docs/screenshots/main.png
> docs/screenshots/completion.png
> docs/screenshots/settings.png
> ```

## 架構

設計說明、IPC 契約、外掛契約與目錄結構都在 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**；
相依套件版本的已驗證事實記錄在 [docs/DEPENDENCY-NOTES.md](docs/DEPENDENCY-NOTES.md)。

兩份契約檔案是唯一的事實來源：

| 契約 | 檔案 |
| ---- | ---- |
| 前端 ↔ Rust 的 IPC | `src/core/ipc/contract.ts` |
| 宿主 ↔ 外掛 | `packages/plugin-api/src/index.ts` |

## 開發

需要 Node 22+、pnpm 11+ 和 Rust stable 工具鏈（以及各平台的 Tauri 系統相依套件）。

```bash
pnpm install          # 安裝相依套件
pnpm dev              # 前端開發伺服器
pnpm tauri dev        # 連同 Rust 核心一起執行桌面應用程式

pnpm typecheck        # 整個儲存庫的 tsc --noEmit（含兩個外掛套件）
pnpm lint             # eslint
pnpm build            # 建置外掛 bundle + 前端 dist/
pnpm build:plugins    # 只建置內建外掛到 public/plugins/<id>/
pnpm format           # prettier --write
```

Rust 端：

```bash
cd src-tauri
cargo fmt --all
cargo clippy --all-targets -- -D warnings
cargo check
```

> `tauri::generate_context!()` 在編譯期需要 `dist/` 存在，所以執行 `cargo check` 之前
> 先跑一次 `pnpm build`（CI 裡也是這麼做的）。

安裝包不在本機封裝，一律由 GitHub Actions 產出並發布到
[Releases](https://github.com/Luc1ferase/NaviShell/releases)。CI 與發版的維護者說明見
[docs/RELEASING.md](docs/RELEASING.md)。

## 外掛開發

外掛是一個目錄，包含資訊清單 `plugin.json` 和一個 CommonJS bundle（預設 `main.js`）。

### 安裝位置

把外掛目錄放到下面的位置，重新啟動應用程式即可被辨識（目錄名稱建議與外掛 id 一致）：

| 平台 | 路徑 |
| ---- | ---- |
| Windows | `%APPDATA%\dev.navishell.app\plugins\<id>\` |
| macOS | `~/Library/Application Support/dev.navishell.app/plugins/<id>/` |
| Linux | `~/.local/share/dev.navishell.app/plugins/<id>/` |

也可以在「設定 → 外掛」裡直接從 zip 安裝，省掉手動複製：

- 發布的 zip 裡，`plugin.json` 放在壓縮檔根目錄，或者放在**唯一**一個頂層目錄下
  （`git archive` 和 GitHub 的「Download ZIP」就是後一種形狀）。
- `plugin.json` 的 `id` 必須符合 `^[a-z0-9][a-z0-9._-]*$`，且不能以 `navishell.`
  開頭（那是內建外掛的前綴）；`main` 指向的檔案必須真的在封裝裡。
- 壓縮檔上限 50 MiB，下載逾時 60 秒，只接受 http / https。可以填一個 SHA-256
  （十六進位，大小寫皆可）讓核心在解壓縮前驗證下載內容。
- 帶絕對路徑、`..`、Windows 磁碟機代號前綴的項目會被拒絕，符號連結項目直接略過。
- id 已經裝過時需要確認覆寫；覆寫是整個目錄取代，舊目錄先移到暫存區，取代失敗會放回去。
- 解除安裝會同時刪掉該外掛的儲存檔 `plugin-data/<id>.json`。

### 外掛市集

頂欄的「擴充功能」按鈕會開啟擴充功能面板，和 VS Code 的擴充功能檢視同一個思路：左邊是清單，
分「市集」「已安裝」「更新」三個檢視，可以搜尋、按分類篩選；右邊是詳細頁，呈現外掛的 README、
變更記錄和版本清單，可以安裝、更新、啟用、停用、解除安裝，也可以裝回某個舊版本。清單來自一份
索引，預設是本儲存庫的 [`registry/plugins.json`](registry/plugins.json)：選取一個外掛就依它
項目裡的 URL 和 SHA-256 安裝，不用自己填位址。索引位址可以在「設定 → 外掛」裡改成自建的
（留空即用預設值）；下載限制是 15 秒、1 MiB，只接受 http / https，欄位不合法的項目會被捨棄並
寫一條日誌，而不是讓整份清單失敗。README 等文件在呈現前會經過消毒（不執行指令碼、只允許
http(s) 的連結和圖片），連結一律用系統瀏覽器開啟。

啟動後不久以及之後每隔幾小時，應用程式會在背景抓取索引檢查外掛更新（可在「設定 → 外掛」裡
關閉），頂欄和狀態列顯示角標並彈出提示；也可以勾選自動安裝目前版本支援的更新。

想讓自己的外掛出現在這份清單裡，往 [`registry/`](registry/) 發一個 PR 就行，項目格式、
zip 的代管方式和 SHA-256 的演算法都寫在 [`registry/README.md`](registry/README.md) 裡。

### 資訊清單 `plugin.json`

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

| 欄位 | 說明 |
| ---- | ---- |
| `id` | 唯一識別碼，小寫，以點 / 連字號分隔；內建外掛使用 `navishell.<name>` |
| `name` / `description` | 字串，或 `{ "en": …, "zh-CN": … }` 的多語言對應 |
| `version` | 外掛版本 |
| `main` | CommonJS 進入點，相對於外掛目錄，預設 `main.js` |
| `styles` | 啟用時注入文件的 CSS 檔案清單 |
| `icon` | [lucide-react](https://lucide.dev/icons/) 圖示名稱 |
| `minHostVersion` | 支援的最低宿主版本 |

### 封裝格式

宿主用 `new Function('module', 'exports', 'require', code)` 執行 `main.js`，
`module.exports`（或 `module.exports.default`）必須是外掛物件。注入的 `require`
**只**解析下面這些宿主模組，它們不能被打進 bundle：

```
react          react/jsx-runtime      react-dom      react-dom/client
@navishell/plugin-api                 lucide-react
```

其餘相依套件必須自行打包。儲存庫內建外掛的 Vite 設定可以直接照抄：
[`scripts/plugin-vite.mjs`](scripts/plugin-vite.mjs)（輸出 CJS、單一檔案、externals 已設好）。

### `PluginContext` 總覽

`activate(ctx)` 拿到的 `ctx` 是外掛能接觸到的全部能力，**不要直接呼叫 `@tauri-apps/*`**：

| 命名空間 | 能做什麼 |
| -------- | -------- |
| `ctx.panels` | 註冊 / 開啟 / 關閉可停駐面板（`register`、`open`、`toggle`） |
| `ctx.commands` | 註冊命令、執行任意命令（`<pluginId>:<id>`） |
| `ctx.servers` | 伺服器清單、連線、開啟終端機 |
| `ctx.connections` | 連線清單、一次性 `exec`、`sftp(connectionId)`、中斷連線 |
| `ctx.terminals` | 終端機控制代碼、輸入/輸出事件、覆蓋層元件、按鍵攔截 |
| `ctx.local` | NaviShell 所在的本機：`platform`、`arch`，以及不經 shell 的一次性 `exec(program, args)` |
| `ctx.storage` | 外掛私有的持久化 KV（`<appData>/plugin-data/<pluginId>.json`） |
| `ctx.i18n` | 註冊翻譯資源、`t()`、目前語言與語言變更事件；`registerLocale()` 貢獻整種語言（語言套件） |
| `ctx.ui` | toast、確認方塊、輸入方塊、檔案選取、儲存對話方塊、右鍵選單 |
| `ctx.log` | 寫入應用程式日誌 |
| `ctx.subscriptions` | 放進去的 `Disposable` 會在外掛停用時自動釋放 |

### 最小範例

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
    // ctx.subscriptions 已自動釋放，這裡只處理自己的資源
  },
});
```

把它建置成 `main.js` + `style.css`，和 `plugin.json` 一起放進上面的外掛目錄即可。
完整範例可以直接讀 [`packages/plugin-sftp`](packages/plugin-sftp) 和
[`packages/plugin-completion`](packages/plugin-completion)。

### 語言套件

介面語言也是外掛：日本語和繁體中文由內建的 `navishell.lang-ja`、`navishell.lang-zh-tw`
提供，和 VS Code 的語言套件同一個思路，可以在「設定 → 外掛」裡停用。一個語言套件只做一件事，
在 `activate` 裡呼叫：

```ts
ctx.i18n.registerLocale({
  id: 'ja', // BCP 47 標籤
  name: '日本語', // 語言選單裡顯示的名稱
  matches: ['ja'], // 跟隨系統時比對哪些系統語言（小寫前綴）
  fallback: 'en', // 缺字串時先試哪個語言，再退回 en
  host: {
    /* 宿主字串，結構同 src/core/i18n/locales/en.json */
  },
  plugins: { 'navishell.sftp': { 'panel.title': 'ファイル' } }, // 依外掛 id 翻譯其他外掛
});
```

指令自動完成外掛的字典說明以 `dict.<指令>` 為鍵放在 `navishell.completion` 的項目裡。
`packages/lang-zh-tw` 就是一份可以直接照抄的範本。

## 授權條款

[Apache License 2.0](LICENSE)。可以自由使用、修改和散布，但再散布或衍生作品必須保留
`LICENSE` 和 `NOTICE` 中的著作權與署名資訊，修改過的檔案需註明變更。
