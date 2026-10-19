# 3D Pose Audio Radar

## ローカル開発

Node.js 24 と Bun 1.4.3 を使用します。

```sh
bun install --frozen-lockfile
npm run dev
```

`npm run lint` で型検査、`npm run build` で本番用の `dist/` を生成します。

## GitHub Pages

`.github/workflows/deploy-pages.yml` が `main` へのプッシュ時に型検査・ビルドを行い、成功した成果物を GitHub Pages にデプロイします。Actions タブから手動実行もできます。追加のデプロイ用シークレットは不要です。

リポジトリの **Settings → Pages** で以下を設定してください。

- **Build and deployment → Source**: **GitHub Actions**
- **Custom domain**: `pose-audio-radar.moukaeritai.work`（設定済みなら維持）
- 証明書の準備後に **Enforce HTTPS** を有効化（カメラ API の利用に必要）

公開先は https://pose-audio-radar.moukaeritai.work/ です。カスタムドメイン直下に配信するため、Vite の `base` は標準の `/` を使います。`public/CNAME` はビルド時に `dist/CNAME` へコピーされますが、Actions によるデプロイでのカスタムドメインは Settings → Pages で管理します。
