# 3D Pose Audio Radar

## ローカル開発

Node.js 24 と Bun 1.4.3 を使用します。

```sh
bun install --frozen-lockfile
npm run dev
```

`npm test` で回帰テスト、`npm run lint` で型検査、`npm run build` で本番用の `dist/` を生成します。プルリクエストでもこれらを自動実行します。

開発サーバー起動前とビルド前に、インストール済みの MediaPipe パッケージから WASM・ローダーを `public/mediapipe/wasm/` にコピーします。これにより JavaScript と WASM のバージョンを揃え、アプリと同じドメインから配信します。生成ファイルは Git 管理対象外です。モデル本体は起動時に `storage.googleapis.com` から取得します。

スウィープは周期変調ホワイトノイズで利用できます。短い時計音・足音は固定位置で提示します。必要なランドマークの可視性が低い場合は方向の更新を止めます。頭部モードは鼻・両耳、肩モードは両肩、複合モードは両方を必要とします。肩幅連動距離では両肩も必要です。背面などで顔が隠れる場合は肩モードを選択してください。

## GitHub Pages

`.github/workflows/deploy-pages.yml` が `main` へのプッシュ時に型検査・ビルドを行い、成功した成果物を GitHub Pages にデプロイします。Actions タブから手動実行もできます。追加のデプロイ用シークレットは不要です。

リポジトリの **Settings → Pages** で以下を設定してください。

- **Build and deployment → Source**: **GitHub Actions**
- **Custom domain**: `pose-audio-radar.moukaeritai.work`（設定済みなら維持）
- 証明書の準備後に **Enforce HTTPS** を有効化（カメラ API の利用に必要）

公開先は https://pose-audio-radar.moukaeritai.work/ です。カスタムドメイン直下に配信するため、Vite の `base` は標準の `/` を使います。`public/CNAME` はビルド時に `dist/CNAME` へコピーされますが、Actions によるデプロイでのカスタムドメインは Settings → Pages で管理します。
