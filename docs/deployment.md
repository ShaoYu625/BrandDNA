# BrandDNA 部署與維運手冊

文件日期：2026-06-16  
適用版本：Cloudflare-first Demo Edition

## 1. 前置需求

本機需要：

- Node.js / npm
- Cloudflare account
- Wrangler，由 `package.json` 的 dev dependency 管理
- OpenAI API key

安裝依賴：

```bash
npm install
```

登入 Cloudflare：

```bash
npx wrangler login
```

非互動式終端或 CI 可改用 `CLOUDFLARE_API_TOKEN` 環境變數。

## 2. 本機開發

產生 Pages 靜態輸出：

```bash
npm run render:pages
```

套用 D1 local migration：

```bash
npm run d1:migrate:local
```

開兩個 terminal：

```bash
npm run dev:api
```

```bash
npm run dev:pages
```

預覽：

```text
http://127.0.0.1:8788
```

API health：

```text
http://127.0.0.1:8787/api/health
```

## 3. Cloudflare 資源

預設名稱：

- Pages project：`branddna-demo-pages`
- API Worker：`branddna-demo-api`
- D1 database：`branddna-demo-db`
- R2 bucket：`branddna-demo-r2`

建立資源：

```bash
python dev.py cloudflare-init
```

這會建立 Pages project、D1 database、R2 bucket，並上傳 `OPENAI_API_KEY` Worker secret。D1 建立後，腳本會將 Wrangler 回傳的 `database_id` 填入：

```text
api/wrangler.toml
```

如果資料庫已經存在，腳本會嘗試用 `wrangler d1 list` 找出同名資料庫 ID 並寫回設定。

## 4. Secrets / Vars

API Worker 必要 secret：

```bash
npx wrangler secret put OPENAI_API_KEY --config api/wrangler.toml
```

Pages 必要 env var：

```text
API_WORKER_ORIGIN=https://branddna-demo-api.<your-subdomain>.workers.dev
```

OpenAI model vars 在 `api/wrangler.toml`，可依部署環境可用模型覆寫：

- `OPENAI_MODEL_SOURCE_ANALYSIS`
- `OPENAI_MODEL_BRAND_DNA`
- `OPENAI_MODEL_DIAGNOSIS`
- `OPENAI_MODEL_IMAGE_PROMPT`
- `OPENAI_MODEL_BRAND_IMAGE`
- `OPENAI_MODEL_CHARACTER_IMAGE`
- `OPENAI_MODEL_CONTENT_GENERATION`
- `OPENAI_MODEL_MARKETING_SUGGESTIONS`
- `OPENAI_MODEL_RISK_CHECK`
- `OPENAI_MODEL_SIMULATION`
- `OPENAI_MODEL_OCR`
- `OPENAI_MODEL_DEFAULT`

## 5. Migration

本機：

```bash
npm run d1:migrate:local
```

遠端：

```bash
npm run d1:migrate:remote
```

Migration 會 seed demo brand：

- `zao_shih`
- `沒事早事坐`
- `台式早午餐`
- `台北市`

## 6. 部署

```bash
python dev.py deploy
```

部署完成後，用 Pages URL 作為對外展示網址。

## 7. 驗收

頁面：

- `/`
- `/data-hub`
- `/diagnosis`
- `/generate`
- `/gatekeeper`
- `/simulation`

API：

- `GET /api/health`
- `GET /api/overview`
- `POST /api/demo/import`
- `POST /api/source-input/website/submit`
- `POST /api/pipeline/run`
- `POST /api/generate-content`
- `POST /api/risk-check`
- `POST /api/simulate`
- `GET /artifacts/:filename`

基本命令：

```bash
npm run render:pages
npm run typecheck
npm run d1:migrate:local
```

遠端部署後：

```bash
python dev.py verify https://<your-pages-project>.pages.dev --api-origin https://branddna-demo-api.<your-subdomain>.workers.dev
```

## 8. 成本控管檢查

部署前確認：

- `OPENAI_API_KEY` 只在 Worker secret。
- `api/src/limits.ts` 的上傳、crawl、OCR、圖片生成限制符合展示期預期。
- Pages `API_WORKER_ORIGIN` 指向正確 Worker。
- `/api/reset` 不會清掉 `usage_events`。
- R2 bucket 有展示期後清理計畫。

## 9. 回滾

此專案現在只保留 Cloudflare-first 版本。若需要回滾，請從版本控制或部署平台回復上一個 Worker / Pages 版本。


## 餐車工作台的 Meta 串接

本機可用模擬的 Graph API 驗收流程。要啟用正式連線，先確認測試資產與部署範圍，再使用餐車版的 Worker 和 Pages 設定。

1. 在 Meta 準備 App 和測試資產。Instagram 配置使用 Unified Login，選擇專業帳號和商務資產組合，並加入內容發布及成效權限。Facebook 使用獨立的 Facebook Login for Business 配置，權杖類型選 User Access Token，授予 `pages_show_list`、`pages_read_engagement`、`pages_manage_posts`、`read_insights`，並確認粉專有發文與分析任務。
2. 兩套配置都登記同一個精確 HTTPS 回呼網址 `https://<工作台網域>/api/truck/meta/callback`。回呼在 Pages 網域，API 由既有 Pages 代理轉給餐車 Worker。以實際測試站與正式站各自的網址設定。
3. 在 `api/wrangler.foodtruck.toml` 填入 `TRUCK_PUBLIC_ORIGIN`、`TRUCK_MERCHANT_AUTH=required`、`META_APP_ID`、`META_GRAPH_VERSION`（程式以 v27.0 驗收）及 `META_IG_CONFIG_ID`、`META_FB_CONFIG_ID` 中要啟用的平台。網域只填 HTTPS origin。
4. 透過 Worker secrets 管理 `META_APP_SECRET` 與 `TRUCK_MERCHANT_KEY`。商家登入金鑰應使用獨立的高熵隨機字串，至少 32 字元。變更 App secret 之後重新授權已選的帳號。商家啟用後，顧客點餐維持公開；商家狀態、上傳、操作與即時更新需要登入。
5. 若要驗證 Unified Login 的 webhook，設定 Worker secret `META_WEBHOOK_VERIFY_TOKEN` 為至少 32 字元的獨立隨機字串。部署後，在 Meta 設定 HTTPS 端點 `https://<工作台網域>/api/truck/meta/webhook`。端點驗證 Meta 簽章，成效仍透過定期同步讀取。
6. 經核准後，建置並部署餐車 Worker 與 Pages。既有 `0004_truck_media.sql` 需已套用，Meta 連線及工作佇列表由既有 Durable Object 初始化。沒有新增 D1 migration 或外部排程服務。

授權後從「工作區設定」選定 IG 或 FB 帳號，每個平台可選一個。先在「資料中心」匯入既有貼文並核對原始網址。按「預覽 Meta 發布版本」確認實際檔案與文案。排程可在送出前取消。若結果顯示待查證，先至平台確認，將該則貼文匯入後可在待查證紀錄連結原貼文。重新連線和更換選定帳號時，既有排程只會對原目標帳號執行。

成效會從所選帳號定期分批同步，也可手動讀取。未回傳的欄位顯示為空值。真實貼文與模擬貼文各自產生成效回饋。資料中心保留原始貼文識別、帳號和時間，供重新建立 Brand DNA 時查核。

「解除連線」會清除工作台的權杖與未送出的排程。若要撤除 Meta 端應用程式授權，從 Meta 的商務整合管理頁確認影響的資產後再移除。首次真實發布需核對測試貼文、目的帳號與時間，並從平台上的原始貼文驗收。

- [Instagram Unified Login 入門](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started)
- [Facebook Pages API](https://developers.facebook.com/documentation/pages-api/overview)
- [Meta 權杖檢查](https://developers.facebook.com/docs/graph-api/reference/debug_token/)
