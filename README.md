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
- `scripts/build-episodes.mjs`: RSSからエピソードページとトップの最新3話を静的生成
- `episodes/episode-<回数>.html`: 検索・共有から直接開けるエピソードページ
- `vercel.json`: Vercel用の静的サイト設定とビルドコマンド

## ローカル確認

先にエピソードページを生成し、静的サーバーで確認できます。最新話APIはVercel上で動作します。

```bash
npm run build
python3 -m http.server 4173
```

## Vercel

GitHubにpush後、VercelでリポジトリをImportしてください。
Framework Presetは `Other`、Build Commandは `vercel.json` の `node scripts/build-episodes.mjs`、Output Directoryは空欄でデプロイできます。独自ドメインへ変更するときは `site.config.json` の `siteUrl` だけを変更してください。
