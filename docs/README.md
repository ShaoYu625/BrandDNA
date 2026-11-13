# BrandDNA Cloudflare Demo Edition

文件日期：2026-06-16  
適用版本：Cloudflare-first Demo Edition

BrandDNA 是 Cloudflare-first 的 AI 品牌經營展示版，用於品牌資料匯入、Brand DNA 分析、圖文生成、規範檢查與市場模擬。

## 產品定位

系統會收集品牌公開資料、社群貼文、官網、評論、招募資訊與內部規範，整理成 Brand DNA，並用同一份品牌脈絡支援：

- 品牌診斷與品牌角色建立。
- Instagram / Facebook 文案生成。
- 品牌圖片與品牌角色圖生成。
- 文案規範與品牌風險檢查。
- Persona 市場反應模擬。

預設示範品牌：

- handle：`zao_shih`
- name：`沒事早事坐`
- category：`台式早午餐`
- location：`台北市`

## 專案結構

```text
.
├─ api/                    # Cloudflare API Worker
│  ├─ wrangler.toml
│  ├─ migrations/
│  └─ src/
├─ pages/                  # Cloudflare Pages
│  ├─ templates/           # 前端模板 source
│  ├─ static/              # 前端靜態資源 source
│  ├─ public/              # 可部署輸出
│  ├─ functions/           # /api 與 /artifacts proxy
│  └─ wrangler.toml
├─ scripts/
│  └─ render-static.mjs    # Nunjucks 靜態渲染
└─ docs/
   ├─ README.md            # 文件入口與系統總覽
   ├─ dashboard_guide.md   # 儀表板完整功能說明
   └─ deployment.md        # 部署與維運
```

開發時請以 `api/`、`pages/`、`scripts/` 為主。

## 系統架構

```text
Browser
  -> Cloudflare Pages
  -> Pages Functions same-origin proxy
  -> Cloudflare API Worker
  -> D1 / R2 / OpenAI / Browser Run
```

主要元件：

- Cloudflare Pages：提供 `pages/public/` 中的靜態頁面與 assets。
- Pages Functions：將 `/api/*`、`/artifacts/*` 代理到 API Worker。
- API Worker：處理 API、資料驗證、AI 呼叫、D1/R2 存取與成本控制。
- D1：保存品牌、來源、抽取結果、分析結果、Brand DNA、jobs、artifacts、usage、logs。
- R2：保存 raw data、uploads、artifacts、generated images、logs。
- OpenAI：由 Worker 端用 secret 呼叫，不暴露給前端。
- Browser Run：只作 URL 擷取 fallback，沒有 binding 時仍可用 fetch-first 流程。

## 快速開始

```bash
npm install
npm run render:pages
npm run d1:migrate:local
```

開兩個 terminal：

```bash
npm run dev:api
npm run dev:pages
```

本機預覽：

```text
http://127.0.0.1:8788
```

API health：

```text
http://127.0.0.1:8787/api/health
```

## 頁面與資料流

主要頁面：

- `/`：一次性方案選擇入口。
- `/dashboard`：總覽。
- `/data-hub`：資料來源輸入、擷取、分析與 pipeline。
- `/diagnosis`：Brand DNA、品牌角色與角色圖。
- `/generate`：社群文案與品牌圖片生成。
- `/gatekeeper`：文案規範與品牌風險檢查。
- `/simulation`：Persona 市場反應模擬。

資料流程：

1. 使用者提交 URL、文字、檔案、圖片或社群貼文組。
2. Worker 驗證 request、檔案大小與來源型態。
3. metadata 寫入 D1 `raw_sources`。
4. raw text / file / image 寫入 R2。
5. 擷取結果寫入 `extraction_results`。
6. OpenAI 分析來源，結果寫入 `analysis_results`。
7. Pipeline 彙整來源分析，建立 `brand_dna_snapshots`。
8. 診斷、生成、守門員、模擬讀取 active Brand DNA。
9. 輸出保存為 D1 `artifacts`，圖片或檔案保存到 R2。

## 儲存設計

D1 tables：

- `brands`
- `raw_sources`
- `extraction_results`
- `analysis_results`
- `brand_dna_snapshots`
- `jobs`
- `artifacts`
- `usage_events`
- `system_logs`

R2 key families：

- `rawdata/{brand_id}/...`
- `uploads/{brand_id}/...`
- `artifacts/{brand_id}/...`
- `generated-images/{brand_id}/...`
- `logs/{date}/...`

`GET /artifacts/:filename` 會從 D1 找 artifact metadata，再讀取 R2 object。

## API

API 維持 same-origin JSON response。前端會為所有 app request 附上本次 session 的方案與 run id：

```text
X-BrandDNA-Plan: FREE | AIR | PRO
X-BrandDNA-Run-Id: <session UUID>
```

成功：

```json
{ "success": true }
```

失敗：

```json
{ "success": false, "error": "..." }
```

主要 endpoints：

- `GET /api/health`
- `GET /api/brand`
- `GET|POST /api/subscription`
- `GET /api/overview`
- `POST /api/demo/import`
- `POST /api/reset`
- `POST /api/global-scan/run`
- `POST /api/global-scan/social-preview`
- `POST /api/source-input/:source_type/submit`
- `GET|POST /api/sources`
- `POST /api/sources/:source_id/extract`
- `POST /api/sources/:source_id/analyze`
- `POST /api/sources/:source_id/fallback`
- `POST /api/pipeline/run`
- `GET /api/jobs`
- `GET /api/logs`
- `GET|POST /api/brand-dna`
- `POST /api/brand-dna/override`
- `POST /api/diagnosis/insights`
- `GET /api/generation-history`
- `GET /api/generation-detail/:identifier`
- `GET /api/latest-generated-post`
- `POST /api/generate-content`
- `POST /api/marketing-demand-suggestions`
- `POST /api/generate-personality-prompt`
- `POST /api/generate-brand-image`
- `POST /api/brand-character-image-prompt`
- `POST /api/generate-brand-character-image`
- `POST /api/risk-check`
- `POST /api/simulate`
- `GET /artifacts/:filename`

## 成本與限制

展示版以穩定、低成本為優先：

- 單檔上傳上限：5MB；展示版檔案使用既有 D1 分塊保存。
- website crawl 最多 5 頁。
- 單頁 HTML 讀取上限：512KB。
- source analysis 最多 8 張 image inputs。
- 圖片生成每次最多 1 張。
- FREE / AIR / PRO quota 依本次 session run 計算。
- Worker 另有 weekly hard limit。
- `/api/reset` 不清除 `usage_events`，避免重設繞過限制。

擷取限制：

- 一般網站採 fetch-first，Browser Run 只是 fallback。
- Instagram / Facebook 不承諾完整自動爬取。
- 社群展示主流程是手動輸入 5 篇貼文與圖片。
- PDF / DOCX / XLS / XLSX / PPTX 會保存到 R2，並回 `needs_manual_text` 走手動補文字。

## 開發規則

- 前端模板改 `pages/templates/`。
- 靜態資源改 `pages/static/`。
- 每次前端 source 變更後執行 `npm run render:pages`。
- API 行為改 `api/src/`。
- D1 schema 變更新增 migration 到 `api/migrations/`。
- 檔案與生成圖片都走 R2，不新增本機 runtime 依賴。

## 文件索引

- [dashboard_guide.md](dashboard_guide.md)：完整說明 BrandDNA 儀表板的頁面、區塊、按鍵、API 與操作流程。
- [deployment.md](deployment.md)：Cloudflare 部署、migration、secrets、驗收與維運。

部署與驗收請看 [deployment.md](deployment.md)；產品操作與展示腳本請看 [dashboard_guide.md](dashboard_guide.md)。
