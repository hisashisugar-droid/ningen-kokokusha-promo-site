# ニンゲン広告社 公式サイト — 切り絵リニューアル版

LINEスタンプの切り絵世界を軸に再設計した、Vercel向けの公式サイトです。

## 構成

- `index.html`: 1ページ構成のサイト本体
- `styles.css`: レスポンシブデザイン
- `app.js`: モバイルナビゲーション
- `assets/ningen-kokokusha-logo-kirie.png`: 新しい切り絵ロゴ
- `assets/01.png`〜`08.png`, `main.png`: 切り絵キャラクター素材
- `api/episodes.js`: RSSから最新3話を取得するVercel Function
- `vercel.json`: Vercel用の静的サイト設定

## ローカル確認

静的サーバーで確認できます。最新話APIはVercel上で動作します。

```bash
python3 -m http.server 4173
```

## Vercel

GitHubにpush後、VercelでリポジトリをImportしてください。
Framework Presetは `Other`、Build Commandは空欄、Output Directoryも空欄でデプロイできます。
