# 釣果灯

釣行、魚種、サイズ、仕掛け、写真を、釣り場の位置を外へ送らずに残すローカルファーストのWebアプリです。

- 公開URL: <https://choka-to.yhay81.com/>
- 運営: `yhay81` の個人プロジェクト
- 候補調査: `legacy-web` candidate `609455fcc02e90e4`

## Product boundary

- 最大100釣行、1釣行100件・全体500件の釣果、写真100枚
- 釣行・釣果・任意の場所メモ・写真はIndexedDBだけに保存
- 位置情報APIを使わず、写真はJPEG 220KB以下へ再圧縮してEXIFを除去
- 位置なし共有札、印刷/PDF、formula-safe CSV、写真込み`.chokato`を書き出し
- サーバーへ送るのは許可済み匿名イベントだけ
- アカウント、公開タイムライン、地図、潮汐・天気自動取得、予約、決済は持たない

ANGLERS等の公開釣果、釣具口コミ、ランキング、釣り仲間探索を置き換えるものではありません。

## Development

```powershell
npm install
npm run release:check
npm run check
npm test
npm run build
npm run dev
```

## Cloudflare

Cloudflare Workers、Hono JSX、Vite+、D1を使います。内容保存はブラウザだけで、D1は匿名計測専用です。

```powershell
npx wrangler d1 create choka-to --location=apac
npx wrangler d1 migrations apply choka-to --remote
npm run deploy
npm run metrics
npm run indexnow
```

D1 の実体は `wrangler.jsonc` の `DB` バインディングへ接続済みです。
