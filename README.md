# ニンゲン広告社 公式サイト

Google Sites版の構成要素をもとにした、Vercel Hobbyプラン向けの静的サイトです。

## 構成

- `index.html`: 1ページ構成のサイト本体
- `styles.css`: レスポンシブデザイン
- `app.js`: モバイルナビゲーション
- `assets/hero-studio.png`: ヒーロービジュアル
- `vercel.json`: Vercel用の静的サイト設定

## ローカル確認

ブラウザで `index.html` を開くか、任意の静的サーバーで確認できます。

```bash
python3 -m http.server 4173
```

## Vercel

GitHubにpush後、VercelでリポジトリをImportしてください。
Framework Presetは `Other`、Build Commandは空欄、Output Directoryも空欄でデプロイできます。
