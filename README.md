# ニンゲン広告社 公式サイト — 切り絵リニューアル版

LINEスタンプの切り絵世界を軸に再設計した、Vercel向けの公式サイトです。

## 構成

- `index.html`: 1ページ構成のサイト本体
- `styles.css`: レスポンシブデザイン
- `app.js`: モバイルナビゲーション
- `assets/ningen-kokokusha-wordmark-v4-red.png`: ヘッダー／トップ用の赤い正式ロゴタイプ
- `assets/ningen-kokokusha-wordmark-v4-white.png`: フッター用の白抜き透過ロゴタイプ
- `assets/ningen-kokokusha-five-characters-v4-hisashi-reclining.png`: 5人入りの別ロゴマーク
- `assets/hero-recording-kirie-v4-canonical-faces.png`: 収録中の切り絵トップ画像
- `assets/member-*-kirie-v*.png`: 文字を除いた社員別の切り絵素材（ヒロシを含む）
- `assets/presentation-kaidan.mp3`: Web限定音声「質疑応答」
- `assets/01.png`〜`08.png`, `main.png`: 元の切り絵キャラクター素材
- `api/episodes.js`: RSSから最新3話を取得し、各SpotifyエピソードへリンクするVercel Function
- `site.config.json`: サイトURL、RSS、Spotify番組URLの共通設定
- `data/episodes-cache.json`: RSS障害時の静的生成に使う正規化済みキャッシュ
- `scripts/build-episodes.mjs`: RSSからエピソード、50件単位の一覧、sitemap、robots、トップの最新3話を静的生成
- `scripts/run-function.mjs`: `api/episodes.js` をHTTP経由で確認するローカル関数ランナー
- `episodes/`: ビルド時だけ生成されるエピソードページと一覧（Git管理外）
- `sitemap.xml` / `robots.txt`: ビルド時に最新内容へ更新されるクロール入口
- `vercel.json`: Vercel用の静的サイト設定とビルドコマンド

## ローカル確認

先にエピソードページを生成し、静的サーバーで確認できます。最新話APIはVercel上で動作します。Vercelの正規URLは拡張子なしですが、標準の静的サーバーで個別ページを直接確認するときは `episodes/episode-278.html` のように `.html` を付けてください。

```bash
npm run build && python3 -m http.server 4173
```

Vercel Functionは別ターミナルで起動し、実際のHTTPレスポンスを確認できます。

```bash
npm run dev:function
curl http://127.0.0.1:4175/api/episodes
```

## Vercel

**計測開始の前提:** Vercelダッシュボードの対象プロジェクトで「Analytics」を有効化し、その後に再デプロイしてください。スクリプトを配置しただけでは計測は始まりません。

GitHubにpush後、VercelでリポジトリをImportしてください。Framework Presetは `Other`、Build Commandは `vercel.json` の `node scripts/build-episodes.mjs`、Output Directoryは空欄でデプロイできます。独自ドメインへ変更するときは `site.config.json` の `siteUrl` だけを変更してください。
