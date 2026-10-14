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
- `vercel.json`: Vercel用の静的サイト設定

## ローカル確認

静的サーバーで確認できます。最新話APIはVercel上で動作します。

```bash
python3 -m http.server 4173
```

## Vercel

GitHubにpush後、VercelでリポジトリをImportしてください。
Framework Presetは `Other`、Build Commandは空欄、Output Directoryも空欄でデプロイできます。
