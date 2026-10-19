<div align="center">

<img src="assets/icon.svg" width="96" alt="NaviShell" />

# NaviShell

**プラグインで拡張できる SSH ターミナル** · Tauri 2 + React 19 + TypeScript

[简体中文](README.md) | [繁體中文](README.zh-TW.md) | [English](README.en.md) | 日本語

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

</div>

NaviShell はクロスプラットフォームの SSH ターミナルクライアントです。接続と転送は
Rust（Tauri 2）が担当し、VS Code 風のドッキング UI は React が描画します。コアは小さく
保ち、**それ以外の機能はすべてフロントエンドのプラグイン**として実装しています。内蔵の
SFTP ファイルマネージャーとコマンド補完もプラグインであり、サードパーティ製プラグインと
まったく同じ API を使っています。

## 機能

- **サーバー管理**：グループ、タグ、カラーマーク。パスワードと秘密鍵のパスフレーズは OS の
  キーチェーン（Windows 資格情報マネージャー / macOS キーチェーン / Linux Secret Service）に
  保存され、設定ファイルには書き込まれません。
- **複数のログイン方式**：パスワード、OpenSSH 秘密鍵（暗号化された鍵のパスフレーズも
  キーチェーンへ）、ssh-agent。サーバーが keyboard-interactive（2FA / OTP を含む）を要求する
  場合は、各プロンプトをダイアログで表示します。
- **踏み台サーバー（ProxyJump）**：サーバー記録に `jumpServerId` を設定すると、まず踏み台に
  接続し、その direct-tcpip チャネル経由で目的のセッションをトンネルします。踏み台の接続を
  閉じると、それを経由する接続もまとめて閉じられます。
- **複数ターミナル**：xterm.js 上の本物の PTY セッション。タブ、分割ドッキング、レイアウトの
  自動保存と復元に対応。
- **ローカルターミナル**：SSH を介さず、このマシン上でシェルを開きます。既定のプログラムは
  Windows では `pwsh.exe`（無ければ `powershell.exe`）、それ以外では `$SHELL`（未設定なら
  `/bin/bash`）。設定の「ローカルシェル」で任意のプログラムと引数に変更できます。
- **ホスト鍵の検証**：初回接続時にフィンガープリントを記録（TOFU）し、変化があれば
  ダイアログで警告します。
- **SFTP ファイルマネージャー**（内蔵プラグイン）：アクティブなターミナルの接続に追従
  （ローカルターミナルには接続がないため、接続のドロップダウンに切り替わります）。閲覧 /
  アップロード / ダウンロード / 名前変更 / 削除 / 新規フォルダー、進捗とキャンセル付きの
  転送リスト、小さなファイルのクイック編集。
- **コマンド補完**（内蔵プラグイン）：サーバーごとにコマンド履歴を記録（ローカルターミナルは
  `local` キーに集約）し、リモートの `~/.bash_history` と `~/.zsh_history` から事前に読み込み
  ます。リモートの `PATH` 上の実行ファイル（`compgen -c`）とリモートディレクトリ内のパスを
  補完し、さらに 275 件の常用コマンド辞書（git / docker / kubectl / systemctl などの
  サブコマンドを含む）を組み合わせて、カーソル下に候補を出典付きで表示します。パスの補完は
  シェルが報告する現在のディレクトリ（OSC 7）に依存します。任意の **シェル統合** スイッチ
  （既定でオフ、コマンド一覧の「シェル統合を有効化/無効化」）を使うと、新しい SSH ターミナルに
  1 行の `PROMPT_COMMAND` / `precmd` フックを注入し、bash と zsh がプロンプトごとに
  ディレクトリを報告するようになります。ポップアップは入力の邪魔をしません。Enter は常に
  入力したとおりのコマンドを実行し、Tab / → でハイライト中の候補を採用します。↑↓ で候補を
  明示的に選んだ後は、Enter でも採用できます。
- **プラグインのインストール**：プラグインフォルダーにディレクトリを置く方法に加えて、
  「設定 → プラグイン」から zip の URL（任意で SHA-256 検証付き）またはローカルの zip
  ファイルからインストールでき、その場でアンインストールも可能。再起動は不要です。
  **プラグインマーケット**のタブでは、レジストリのインデックスに載っているプラグインを
  一覧から 1 クリックでインストールできます。
- **アプリ内アップデート**：起動後（設定で無効化可能）および「設定 → このアプリについて」から
  最新の GitHub Release を確認し、確認後にダウンロード・インストール・再起動します。すべての
  バンドルには minisign 署名が付き、署名が一致しなければ必ず拒否されます。
- **多言語 UI**：英語と簡体字中国語は内蔵。日本語と繁體中文は **言語パックプラグイン** として
  同梱されます（VS Code の言語パックと同様で、「設定 → プラグイン」から無効化できます）。UI
  の言語はシステムに追従するか手動で選べます。どのプラグインも `ctx.i18n.registerLocale` で
  言語を丸ごと提供でき、他のプラグインの文字列も翻訳できます。通常のプラグインは
  `addResources` で自分の翻訳を登録します。
- **UI テーマとターミナル配色は別々**：UI はダーク / ライト / システム追従の 3 択で、すべての
  色は 1 組の CSS 変数から生成され、プラグインも同じ変数を使います。ターミナルは内蔵の 16
  種類（One Half、Dracula、Nord、Gruvbox、Solarized、Catppuccin、Monokai、Campbell など）
  から選び、ダーク UI 用とライト UI 用を別々に記憶するので、ライト UI でダークなターミナルも
  使えます。4.5 : 1 の最低コントラスト（VS Code と同じ既定値）が有効で、背景に溶け込む文字色
  は自動で調整されます。

## スクリーンショット

> 追加予定：メイン画面（ターミナル + サーバー一覧 + SFTP パネル）、補完ポップアップ、設定
> ページ。
>
> ```
> docs/screenshots/main.png
> docs/screenshots/completion.png
> docs/screenshots/settings.png
> ```

## アーキテクチャ

設計メモ、IPC コントラクト、プラグインコントラクト、ディレクトリ構成は
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** に、依存バージョンに関する検証済みの事実は
[docs/DEPENDENCY-NOTES.md](docs/DEPENDENCY-NOTES.md) にまとめています。

2 つのコントラクトファイルが唯一の信頼できる情報源です：

| コントラクト | ファイル |
| ------------ | -------- |
| フロントエンド ↔ Rust の IPC | `src/core/ipc/contract.ts` |
| ホスト ↔ プラグイン | `packages/plugin-api/src/index.ts` |

## 開発

Node 22 以上、pnpm 11 以上、Rust の stable ツールチェーン（および各プラットフォームの Tauri
システム依存関係）が必要です。

```bash
pnpm install          # 依存関係のインストール
pnpm dev              # フロントエンドの開発サーバー
pnpm tauri dev        # Rust コアと一緒にデスクトップアプリを起動

pnpm typecheck        # リポジトリ全体の tsc --noEmit（2 つのプラグインパッケージを含む）
pnpm lint             # eslint
pnpm build            # プラグインバンドル + フロントエンドの dist/ をビルド
pnpm build:plugins    # 内蔵プラグインのみ public/plugins/<id>/ へビルド
pnpm format           # prettier --write
```

Rust 側：

```bash
cd src-tauri
cargo fmt --all
cargo clippy --all-targets -- -D warnings
cargo check
```

> `tauri::generate_context!()` はコンパイル時に `dist/` の存在を必要とするため、
> `cargo check` の前に一度 `pnpm build` を実行してください（CI も同じ手順です）。

ローカルではパッケージングを行いません。インストーラーは GitHub Actions がビルドし、
[Releases](https://github.com/Luc1ferase/NaviShell/releases) に公開されます。CI とリリース手順の
メンテナー向け説明は [docs/RELEASING.md](docs/RELEASING.md) を参照してください。

## プラグイン開発

プラグインは、マニフェスト `plugin.json` と 1 つの CommonJS バンドル（既定では `main.js`）を
含むディレクトリです。

### インストール場所

プラグインディレクトリを以下の場所に置き、アプリを再起動すると認識されます（ディレクトリ名は
プラグイン id と同じにすることを推奨）：

| プラットフォーム | パス |
| ---------------- | ---- |
| Windows | `%APPDATA%\dev.navishell.app\plugins\<id>\` |
| macOS | `~/Library/Application Support/dev.navishell.app/plugins/<id>/` |
| Linux | `~/.local/share/dev.navishell.app/plugins/<id>/` |

「設定 → プラグイン」から zip を直接インストールすれば、手動コピーは不要です：

- 配布する zip では、`plugin.json` をアーカイブのルート、または **唯一の** トップレベル
  ディレクトリの直下に置きます（`git archive` と GitHub の「Download ZIP」は後者の形です）。
- `plugin.json` の `id` は `^[a-z0-9][a-z0-9._-]*$` に一致し、`navishell.` で始まっては
  いけません（内蔵プラグインの接頭辞です）。`main` が指すファイルは実際にアーカイブ内に存在
  する必要があります。
- アーカイブの上限は 50 MiB、ダウンロードのタイムアウトは 60 秒、受け付けるのは http / https
  のみです。SHA-256（16 進、大文字小文字どちらでも可）を指定すると、展開前にダウンロード内容を
  検証します。
- 絶対パス、`..`、Windows のドライブ文字を含むエントリは拒否され、シンボリックリンクの
  エントリはスキップされます。
- すでに同じ id がインストール済みの場合は上書きの確認を求めます。上書きはディレクトリ全体の
  置き換えで、旧ディレクトリは先に退避され、置き換えに失敗すれば元に戻されます。
- アンインストールすると、そのプラグインのストレージファイル `plugin-data/<id>.json` も
  削除されます。

### プラグインマーケット

「設定 → プラグイン → プラグインマーケット」は、レジストリのインデックス（既定ではこの
リポジトリの [`registry/plugins.json`](registry/plugins.json)）を一覧表示します。選んだ
プラグインは、そのエントリーに書かれた URL と SHA-256 でインストールされるので、アドレスを
入力する必要はありません。インデックスの URL は「設定 → プラグイン」で自前のものに変更
できます（空欄なら既定の URL）。ダウンロードは 15 秒・1 MiB が上限で、受け付けるのは
http / https のみ。フィールドが不正なエントリーは、一覧全体を失敗させずにログ警告付きで
破棄されます。

自分のプラグインをこの一覧に載せるには、[`registry/`](registry/) に対してプルリクエストを
送ってください。エントリーの形式、zip のホスティング方法、SHA-256 の求め方は
[`registry/README.md`](registry/README.md) に書いてあります。

### マニフェスト `plugin.json`

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

| フィールド | 説明 |
| ---------- | ---- |
| `id` | 一意の識別子。小文字、ドット / ハイフン区切り。内蔵プラグインは `navishell.<name>` |
| `name` / `description` | 文字列、または `{ "en": …, "zh-CN": … }` 形式の多言語マップ |
| `version` | プラグインのバージョン |
| `main` | CommonJS エントリ。プラグインディレクトリからの相対パス、既定は `main.js` |
| `styles` | 有効化時にドキュメントへ注入する CSS ファイルの一覧 |
| `icon` | [lucide-react](https://lucide.dev/icons/) のアイコン名 |
| `minHostVersion` | サポートする最小のホストバージョン |

### バンドル形式

ホストは `new Function('module', 'exports', 'require', code)` で `main.js` を実行します。
`module.exports`（または `module.exports.default`）がプラグインオブジェクトでなければ
なりません。注入される `require` は **以下のホストモジュールだけ** を解決し、これらを
バンドルに含めてはいけません：

```
react          react/jsx-runtime      react-dom      react-dom/client
@navishell/plugin-api                 lucide-react
```

それ以外の依存関係は自分でバンドルしてください。内蔵プラグインの Vite 設定はそのまま流用
できます：[`scripts/plugin-vite.mjs`](scripts/plugin-vite.mjs)（CJS 出力、単一ファイル、
externals 設定済み）。

### `PluginContext` の概要

`activate(ctx)` で受け取る `ctx` が、プラグインが触れられる機能のすべてです。
**`@tauri-apps/*` を直接呼び出してはいけません。**

| 名前空間 | できること |
| -------- | ---------- |
| `ctx.panels` | ドッキング可能なパネルの登録 / 表示 / 非表示（`register`、`open`、`toggle`） |
| `ctx.commands` | コマンドの登録、任意のコマンドの実行（`<pluginId>:<id>`） |
| `ctx.servers` | サーバー一覧、接続、ターミナルを開く |
| `ctx.connections` | 接続一覧、ワンショットの `exec`、`sftp(connectionId)`、切断 |
| `ctx.terminals` | ターミナルハンドル、入出力イベント、オーバーレイコンポーネント、キー割り込み |
| `ctx.storage` | プラグイン専用の永続 KV（`<appData>/plugin-data/<pluginId>.json`） |
| `ctx.i18n` | 翻訳リソースの登録、`t()`、現在のロケールとロケール変更イベント。`registerLocale()` で UI 言語全体（言語パック）を提供 |
| `ctx.ui` | トースト、確認ダイアログ、入力ダイアログ、ファイル選択、保存ダイアログ、コンテキストメニュー |
| `ctx.log` | アプリケーションログへの書き込み |
| `ctx.subscriptions` | ここに入れた `Disposable` はプラグイン無効化時に自動で解放される |

### 最小の例

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
    // ctx.subscriptions は自動で解放されるので、ここでは自前のリソースだけを片付ける
  },
});
```

これを `main.js` + `style.css` にビルドし、`plugin.json` と一緒に上記のプラグイン
ディレクトリへ置けば完成です。完全な例は [`packages/plugin-sftp`](packages/plugin-sftp) と
[`packages/plugin-completion`](packages/plugin-completion) を参照してください。

### 言語パック

UI の言語もプラグインです。日本語と繁體中文は内蔵の `navishell.lang-ja` と
`navishell.lang-zh-tw` が提供しており、VS Code の言語パックと同じ考え方で、
「設定 → プラグイン」から無効化できます。言語パックが `activate` で行うのはこれだけです：

```ts
ctx.i18n.registerLocale({
  id: 'ja', // BCP 47 タグ
  name: '日本語', // 言語メニューに表示する名前
  matches: ['ja'], // システムに追従するときに一致させる OS 言語（小文字のプレフィックス）
  fallback: 'en', // 文字列が無いときに en より先に試すロケール
  host: {
    /* ホストの文字列。構造は src/core/i18n/locales/en.json と同じ */
  },
  plugins: { 'navishell.sftp': { 'panel.title': 'ファイル' } }, // 他のプラグインをプラグイン id ごとに翻訳
});
```

コマンド補完プラグインの辞書の説明は、`navishell.completion` のバンドル内に
`dict.<コマンド>` というキーで置きます。`packages/lang-ja` をそのままテンプレートとして使えます。

## ロードマップ

v1 以降に計画した方向性とその状態（議論は対応する issue で）：

| # | 方向性 | 状態 |
| - | ------ | ---- |
| [#1](../../issues/1) | 秘密鍵ログイン（PEM / OpenSSH、パスフレーズ） | 0.2.0 で実装済み |
| [#2](../../issues/2) | ssh-agent 対応 | 0.2.0 で実装済み |
| [#3](../../issues/3) | ProxyJump / 踏み台サーバー | 0.2.0 で実装済み |
| [#4](../../issues/4) | keyboard-interactive（2FA を含む） | 0.2.0 で実装済み |
| [#5](../../issues/5) | アプリ内自動アップデート | 0.2.0 で実装済み |
| [#6](../../issues/6) | ローカルターミナル（SSH を介さない） | 0.2.0 で実装済み |
| [#7](../../issues/7) | URL からのプラグインインストール + プラグインマーケット | 0.2.0 で実装済み |
| [#8](../../issues/8) | リモート環境を認識するコマンド補完（辞書ではなく本物の補完） | 0.2.0 で実装済み |

プラグインマーケット（#7 で触れたレジストリのインデックス JSON）は
[`registry/plugins.json`](registry/plugins.json) として「設定 → プラグイン →
プラグインマーケット」に出ています。インデックスはまだ空なので、プラグインを追加する
プルリクエストを歓迎します。

## ライセンス

[Apache License 2.0](LICENSE)。自由に利用・改変・再配布できますが、再配布物や派生物には
`LICENSE` と `NOTICE` の著作権表示と帰属表示を残し、改変したファイルにはその旨を記載してください。
