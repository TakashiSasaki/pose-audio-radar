# AGENT.md - AI エージェント作業規定・開発ルール

このリポジトリで作業を行うすべての AI アシスタントおよび開発者は、以下のルールと開発指針を厳格に遵守してください。

---

## 1. バージョン管理ルール（重要）

### 1.1 バージョン番号の正本（Single Source of Truth）
* **正本ファイル**: プロジェクトルートの **`package.json`** の `"version"` フィールド。
* **初期基準バージョン**: `1.0.0`
* **禁止事項**: `version.ts` や別ファイルにバージョン文字列を手動で二重管理・ハードコードしてはなりません。

### 1.2 ビルドツール（Vite）による自動連動
* **自動注入メカニズム**:
  - `vite.config.ts` 内で `package.json` の `version` を読み込み、`define: { __APP_VERSION__: JSON.stringify(packageJson.version) }` でコンパイル時定数として注入します。
  - TypeScriptの型定義は `src/vite-env.d.ts`（`declare const __APP_VERSION__: string;`）で提供されます。
  - アプリケーション側（`src/` 配下）では `__APP_VERSION__` を参照するだけで、`package.json` の更新がビルド・画面表示に100%自動反映されます（手動コピペや二重更新は一切不要）。

### 1.3 パッチレベルのバンプアップ義務
* **ルール**: **コードに少しでも変更（機能追加・修正・リファクタリング・調整・設定変更等）を加えた場合は、必ずパッチバージョンを1段階インクリメント（バンプアップ）すること。**
  - 例: `1.0.0` → `1.0.1` → `1.0.2` ...
* パッチバンプアップ手順:
  1. `package.json` の `"version"` を更新する。
  2. `npm i --package-lock-only` を実行して、`package-lock.json` 内のバージョンを同期させる。
  3. ビルドおよびテストを実行し、正常終了することを確認する。

---

## 2. パッケージマネージャー & CI 規定

* **標準ツール**: **Node.js (v24系) / npm** を使用すること（Bun は使用しない）。
* **依存解決**:
  - Tailwind CSS v4 や Vite などのネイティブバイナリ（`optionalDependencies`）とのクロスプラットフォーム整合性を保つため、GitHub Actions ワークフロー（`.github/workflows/`）のインストールコマンドは `npm install` を採用すること（`npm ci` は使用しない）。
  - パッケージの追加や更新は必ず `npm install <pkg>` で行い、`package.json` と `package-lock.json` を常に同期した状態でコミットすること。

---

## 3. 品質検証・テスト手順

コード変更を行った際は、作業終了前に以下のコマンドを順次実行してすべてパスすることを確認すること：

```bash
# 型検査
npm run lint

# 回帰テスト（全55件以上）
npm test

# 本番ビルド
npm run build
```
