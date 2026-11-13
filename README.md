# BrandDNA 餐車工作台

給行動餐車用的品牌經營工作台：品牌診斷、AI 貼文、行事曆、顧客掃碼點餐、會員分群推播與折扣碼。部署在獨立 Cloudflare 專案。

## 版本沿革

目前版本使用 TypeScript 與 Cloudflare，後續開發集中在 `main` 分支。Python／Flask 初版已封存，保留完整原始碼與提交紀錄，供展示與回顧。

- [Flask 初版封存分支 `legacy/flask`](https://github.com/ShaoYu625/BrandDNA/tree/legacy/flask)
- [Flask 初版版本標記 `v1-flask`](https://github.com/ShaoYu625/BrandDNA/tree/v1-flask)
- [下載 Flask 初版原始碼](https://github.com/ShaoYu625/BrandDNA/archive/refs/tags/v1-flask.zip)

## 線上入口

- 商家工作台：https://branddna-foodtruck.pages.dev（需登入）
- 顧客點餐：https://branddna-foodtruck.pages.dev/order?truck=haihai（不帶參數＝海海人生）

## 帳號

一台餐車＝一個帳號（店名、帳號、密碼）。同一個瀏覽器可以同時登入多台餐車，左上角的店名按鈕就是「切換餐車」，右上角頭像是帳號選單（變更密碼、登出）。登入頁的「先前登入的帳號」預設列出海海人生。

| 帳號 | 預設密碼 | 說明 |
| --- | --- | --- |
| `haihai` | `haihai2026` | 海海人生行動餐車（預建帳號，含範例菜單、訂單、會員）。部署前可用 `TRUCK_FLAGSHIP_PASSWORD` secret 改掉初始密碼；登入後也能在「工作區設定 → 帳號」變更。 |

在 `/register` 可以註冊新餐車，會得到全新的空白工作台與「開始設定」清單。

## 功能一覽（第一次使用請看工作台裡的「使用教學」）

- **商家總覽**：今日訂單與營收、待確認草稿、下一場出攤；右上角鈴鐺是分類通知（訂單、貼文、出攤、會員、系統），只列需要處理的事。
- **資料中心**：頁面上方直接「新增品牌資料」（不用另開視窗）：手動輸入、官網 HTML（上傳另存的 .html 檔，附三步驟教學；瀏覽器端解析，Worker 不抓網址）、圖片文字辨識、批次貼上、多個檔案。
- **品牌診斷**：品牌定位、溝通語氣、核心客群、差異化優勢、內容主軸五個面向。語氣與客群只從「語氣庫／客群庫」挑，滑過標籤看定義與範例；差異化優勢＝跟「一般餐車基準」比較後優於一般的項目（點餐、會員、發文、出攤、外語由系統依實際資料判斷）。三個庫在 `pages/static/truck/brand-libraries.mjs`，修改規則見 `.claude/skills/brand-libraries/SKILL.md`。12 種人格只顯示前五名，其他收合。
- **貼文工作區**：快速開始分四類——內容主軸（來自品牌診斷）、趨勢（這幾天大家都在聊的話題，不限領域：Worker 抓 Google 新聞台灣頭條＋Google 搜尋趨勢，AI 歸納成話題，挑討論度最高又最好發揮的三個；每個話題附來源連結、風險等級與 3 個玩梗角度＋搭配的時事優惠，點「用這個梗寫貼文」可以順便建立時事折扣碼並寫進文案；災難、選舉、軍事等高風險話題另外列在「不建議搭」；趨勢貼文編輯時固定顯示風險提醒）、季節性（節慶與季節）、餐車營運（標示多久沒發）。三天沒發文或排程時，系統挑久未輪到的主題直接準備好草稿並通知。連結 Meta 可自動發布；沒連結時複製文案、下載發布圖後「標記為已發布」，再填寫成效。
- **行事曆與發文**：出攤（綠）與貼文（橘）在同一個月曆；排程或新增出攤時可選顏色標籤，按「自訂」建立自己的類型＋顏色（最多 12 個），系統會記住，同一類貼文下次自動帶入。
- **節慶 LOGO**：商家工作台與顧客點餐頁的 logo 會依台北日期自動換上節慶裝飾與動畫（跨年、農曆新年、元宵、情人節、母親節、端午、七夕、中秋、萬聖、聖誕）。展示時在網址加 `?festival=christmas`（或 `newyear`、`lunar`、`lantern`、`valentine`、`mother`、`dragonboat`、`qixi`、`midautumn`、`halloween`）可提前預覽，`?festival=auto` 回到依日期。農曆日期表在 `festive.mjs`，目前到 2030 年。
- **貼文成效**：手動填寫或 Meta 同步；「加入資料中心」後直接跳到資料中心。
- **訂單管理**：接單狀態、待製作彙總與三欄標題凍結在頂端；新訂單／製作中／待取餐三欄（先來先做、顯示等候時間與待製作彙總）；新訂單響提示音、跳提醒、分頁標題顯示筆數，開著時螢幕不關閉。「接單並開始製作」一步完成，按錯可「退回」，可「取消」（附原因，折扣碼自動退回），收攤「全部完成取餐」，可「暫停接單」並留言給顧客。「顧客點餐 QR Code 素材」在頁面最下方、預設收合，可下載 QR PNG／SVG、A5 海報、方形桌卡，或複製點餐連結。
- **菜單管理**：新增／編輯／刪除、上傳照片、排序、上下架、一鍵「今日售完」（隔天自動恢復）、英文菜單（可 AI 一次翻譯）。
- **會員管理**：分「會員／訪客」。訪客（沒加入會員直接點餐）只列姓名與電話，不做分析。會員：上次消費、次數、累積消費、平均單價可排序；RFM 自動分出常來客、潛在客、流失客，各自推播活動（買一送一、滿額折、打折）或專屬折扣碼；公開折扣碼管理；會員輪廓（性別、年齡、縣市、職業、收入、得知管道）。
- **顧客點餐頁**：中／英切換（訂單一律以中文送到商家）、加入會員（手機必填）、填會員資料送折扣碼（分組題目、必填進度條；行政區依縣市連動，全台 368 鄉鎮市區）、「我的會員」看優惠與推播訊息（新訊息有標記），也能查看與修改自己的資料、結帳輸入折扣碼。送單後顯示短取餐號碼與「前面還有幾單」，可同時追蹤多張訂單，餐好了手機震動＋提示音；購物車裡的餐點售完會自動移除並提示。已是會員的手機號碼在新裝置需要店家在「會員資料」產生的一次性登入碼，避免他人輸入號碼冒用優惠。

## AI（OpenAI）

餐車工作台的 AI 全部使用 `gpt-6-luna`（US$0.10／US$0.50 每百萬 input／output tokens，可讀圖）：貼文草稿、品牌診斷、趨勢（把 Google 新聞頭條與 Google 搜尋趨勢 RSS 歸納成話題、想梗與時事優惠、判斷風險；兩個 RSS 每天第一次打開貼文工作區時由 Worker 抓取，來源連結只取自 RSS）、英文菜單、圖片文字辨識、推播文案。每台餐車每月上限 `TRUCK_AI_MONTHLY_BUDGET_USD`（預設 US$2），用量顯示在「工作區設定 → AI 助理」。沒有金鑰、額度用完或 OpenAI 失敗時，會自動改用內建範本，操作不會中斷。

線上啟用需設定 Worker secret（本機開發讀 `api/.dev.vars`）：

```powershell
npx wrangler secret put OPENAI_API_KEY --config api/wrangler.foodtruck.toml
```

舊版 `/legacy/*` 工具的模型設定維持在 `api/wrangler.toml`（`gpt-6-luna`／`gpt-6.1-terra`／`gpt-image-2.5-flare`，每週上限 `OPENAI_WEEKLY_BUDGET_USD`），新版介面已不再連到舊版。

## 維護與部署

架構：Nunjucks Pages／TypeScript Worker／D1／Durable Object。

- 前端 `pages/static/truck/`：`merchant.mjs`（事件與流程）、`merchant-views.mjs`（外框、總覽、資料中心、診斷、貼文）、`merchant-import.mjs`（資料中心新增資料、官網 HTML 解析）、`merchant-dna.mjs`（語氣／客群說明、一般餐車比較）、`merchant-quickstart.mjs`（快速開始四類、趨勢風險提醒）、`merchant-labels.mjs`（行事曆顏色標籤）、`secondary.mjs`（行事曆、訂單、成效、設定）、`merchant-menu.mjs`、`merchant-members.mjs`、`merchant-notify.mjs`、`merchant-assets.mjs`（QR 素材）、`merchant-guide.mjs`（教學）、`merchant-auth.mjs`（登入／註冊／切換）、`merchant-modals.mjs`、`festive.mjs`（節慶 LOGO）、`customer.mjs`（顧客點餐）。前後端共用的資料：`brand-libraries.mjs`（語氣庫、客群庫、一般餐車基準）、`tw-districts.mjs`（縣市與行政區）；Worker 透過旁邊的 `.d.mts` 型別直接 import。
- 後端 `api/src/`：`routes/truck.ts`（純函式領域邏輯與 HTTP 契約）、`truck-workspace.ts`（每台餐車一個 Durable Object；海海人生沿用原本的 `workspace` 物件，資料不會遺失）、`truck-accounts.ts`（D1 帳號與登入）、`truck-ai.ts`（OpenAI 與網頁擷取）。帳號資料表會在第一次請求時自動建立（也提供 `migrations/0006_truck_accounts.sql`）。
- 舊資料第一次被讀取時會自動升級：補上新欄位、移除舊版的「示範／模擬」標示並換成產品版範例資料，團隊自建的資料保留。
- 每日 cron：各餐車檢查發文節奏（三天提醒），並清除沒有任何餐車引用的上傳照片。
- 免費額度設計沿用：Durable Object 只寫入變動列、WebSocket 推播、`Idempotency-Key` 防重送、各集合有上限。

```powershell
npm test
npm run typecheck
npm run test:e2e          # 需先啟動本機 API（8787）與 Pages（8788）
npm run deploy:foodtruck:api
npm run deploy:foodtruck:pages
```

`test:e2e` 預設測 `http://127.0.0.1:8788`，驗證線上站可設 `$env:DEMO_URL='https://branddna-foodtruck.pages.dev'`（密碼不是預設值時再設 `$env:TRUCK_PASSWORD`）。測試會建立名稱含「驗收」的資料，菜單、出攤與資料中心的測試項目會自行刪除。


---

# 舊版 BrandDNA Cloudflare Demo

這份專案已經有根目錄一鍵腳本。日常測試優先用 Python 入口，不需要手動記多個 `npm run ...` 指令。

## 本機執行

先確認有安裝：

- Python 3.11+
- Node.js LTS / npm

Windows 上如果找不到 Node.js，`python dev.py` 會優先嘗試用 `winget` 自動安裝 Node.js LTS，並在同一次執行中重新載入 PATH。若不想讓腳本自動安裝工具，可加上 `--no-auto-install`。

在專案根目錄執行：

```powershell
python dev.py
```

這會自動做幾件事：

1. 建立 `api/.dev.vars` 和 `pages/.dev.vars`
2. 詢問並保存 `OPENAI_API_KEY`，也可以先略過
3. 執行 `npm install`
4. 產生 Pages 靜態檔
5. 執行 TypeScript 檢查
6. 套用本機 D1 migration
7. 同時啟動 API Worker 和 Cloudflare Pages
8. 打開 `http://127.0.0.1:8788`

如果只想安裝與準備，不啟動服務：

```powershell
python dev.py setup
```

如果只想執行系統測試檢查，不啟動長時間常駐的本機服務：

```powershell
python dev.py test
```

環境檢查：

```powershell
python dev.py doctor
```

## 本機網址

- App: `http://127.0.0.1:8788`
- API health: `http://127.0.0.1:8787/api/health`
- Pages proxy health: `http://127.0.0.1:8788/api/health`

## 第一次設定 Cloudflare

先登入 Cloudflare：

```powershell
npx wrangler login
```

如果是在非互動式終端或 CI 環境，改用 Cloudflare API token：

```powershell
$env:CLOUDFLARE_API_TOKEN="你的 Cloudflare API token"
```

再執行：

```powershell
python dev.py cloudflare-init
```

這會嘗試建立：

- Pages project: `branddna-demo-pages`
- D1 database: `branddna-demo-db`
- R2 bucket: `branddna-demo-r2`
- Worker secret: `OPENAI_API_KEY`

如果 D1 是第一次建立，腳本會自動把 `database_id` 寫回 `api/wrangler.toml`。如果 D1 已經存在，腳本會嘗試用 `wrangler d1 list` 找出同名資料庫 ID 並寫回設定。

## 部署到 Cloudflare

本機確認 OK 後：

```powershell
python dev.py deploy
```

這會執行 build/typecheck、套用遠端 D1 migration、部署 API Worker，再用正確的 Worker URL 部署 Pages。

部署後可驗收 Pages 與 API proxy：

```powershell
python dev.py verify https://你的-pages-project.pages.dev
```

如果要同時直接檢查 Worker：

```powershell
python dev.py verify https://你的-pages-project.pages.dev --api-origin https://你的-api-worker.workers.dev
```

## 推上 GitHub 並連結 Cloudflare

專案使用既有的 [ShaoYu625/BrandDNA](https://github.com/ShaoYu625/BrandDNA) repository。第一次下載：

```powershell
gh repo clone ShaoYu625/BrandDNA
cd BrandDNA
```

日常更新從 `main` 建立工作分支，提交後透過 Pull Request 合併：

```powershell
git switch main
git pull --ff-only
git switch -c feature/your-change
git add .
git commit -m "Describe the change"
git push -u origin HEAD
```

Cloudflare 的 GitHub 連結需要在 Dashboard 用瀏覽器授權：

1. 到 Cloudflare Dashboard
2. Workers & Pages -> Create application -> Pages
3. Connect to Git
4. 選你的 GitHub repo
5. 如果使用這個 repo 結構，建議 Root directory 設 `pages`
6. Build command 設 `cd .. && npm install && npm run render:pages`
7. Build output directory 設 `public`
8. Environment variable 設 `API_WORKER_ORIGIN=https://你的-api-worker.workers.dev`

API Worker、D1、R2 和 OpenAI secret 仍建議用 `python dev.py cloudflare-init` 與 `python dev.py deploy` 管理。
