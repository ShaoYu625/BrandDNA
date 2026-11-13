# BrandDNA 儀表板完整功能說明

文件日期：2026-06-16  
適用版本：Cloudflare-first Demo Edition

本文是 BrandDNA 儀表板的完整操作與功能說明，說明範圍包含六個主要頁面、共用導覽、每個區塊、主要按鍵、前端互動、後端 API、D1 / R2 / OpenAI 的資料流，以及展示時建議的操作順序。

BrandDNA Demo Edition 的目的不是正式多租戶 SaaS，而是讓審查者可以透過固定 Cloudflare Pages 網址實際操作一套品牌資料分析、Brand DNA 建立、圖文生成、風險檢查與市場預測流程。

## 1. 整體操作地圖

儀表板保留現有資訊架構，主要路徑如下：

- `/`：一次性方案選擇入口。選擇 `FREE`、`AIR` 或 `PRO` 後進入儀表板。
- `/dashboard`：總覽。用於快速查看資料、Brand DNA、成果與下一步待辦。
- `/data-hub`：資料中心。用於新增來源、擷取、分析、手動補資料與建立 Brand DNA。
- `/diagnosis`：品牌診斷／品牌角色。用於檢視 12 品牌人格、品牌角色設定與角色圖。
- `/generate`：圖文生成。用於依 Brand DNA 生成 IG / FB 文案與貼文概念圖。
- `/gatekeeper`：規範守門員。用於檢測文案風險、品牌規範與安全改寫。
- `/simulation`：市場預測。用於把已生成文案丟給不同客群做接受度模擬。

標準展示流程：

1. 進入 `/` 選擇本次使用方案。
2. 進入 `/data-hub`。
3. 用「填寫來源示範」或手動輸入至少 3 種有效資料來源。
4. 按「送出全部可用來源」或逐一按「送出此來源」。
5. 在「來源處理」確認整理與分析狀態。
6. 按「重新建立品牌角色」，或等待資料送出流程自動建立。
7. 到 `/diagnosis` 檢視人格、品牌角色與角色圖。
8. 到 `/generate` 輸入行銷需求，生成貼文與概念圖。
9. AIR / PRO 可到 `/gatekeeper` 檢查生成文案。
10. AIR / PRO 可到 `/simulation` 選客群與貼文，產生市場預測。

## 2. 共用介面與全域行為

所有頁面共用 `pages/templates/base.html` 的外殼與互動邏輯。

### 2.1 左側導覽列

左側導覽列提供六個主要入口：

- 「總覽」連到 `/dashboard`。
- 「資料中心」連到 `/data-hub`。
- 「品牌診斷／品牌角色」連到 `/diagnosis`。
- 「圖文生成」連到 `/generate`。
- 「市場預測」連到 `/simulation`。

目前導覽中沒有獨立顯示「規範守門員」連結，但頁面存在於 `/gatekeeper`，可由網址或其他流程導入。若未來要放回導覽，應只修改導覽入口，不應改變 `/gatekeeper` 路徑與頁面內容。

導覽會依 `currentPath` 顯示 active 狀態。桌面版是完整側欄；中等寬度或矮螢幕會變成窄版圖示列，使用「展開選單」按鈕或 hover 展開；手機版會變成底部導覽。

### 2.2 一次性方案

`/` 會顯示三張方案卡：

- `FREE`
- `AIR`
- `PRO`

選擇方案後，前端會將 `branddna:selectedPlan` 與 `branddna:runId` 寫入 `sessionStorage`。所有 API request 會附上：

```text
X-BrandDNA-Plan: FREE | AIR | PRO
X-BrandDNA-Run-Id: <session UUID>
```

前端收到方案狀態後更新：

- 頁首目前方案卡。
- 文案 quota 標籤。
- 圖片 quota 標籤。
- 依 `plan_info.features` 以深灰 overlay 鎖住或開放功能入口與頁面。

這不是正式金流或會員系統，也沒有帳號狀態。API Worker 仍會依 request plan/run id 做 quota 與功能硬限制。

### 2.3 頁首方案與用量

頁首右側有：

- 目前方案卡：例如 `FREE 方案`、`AIR 方案`、`PRO 方案`。
- 文案 quota：顯示 `文案 used / limit`。
- 圖片 quota：顯示 `圖片 used / limit`。
- AI 用量標籤：顯示 tokens 與估算成本。
- 重新整理用量按鈕：呼叫 `GET /api/subscription`。
- 變更方案按鈕：回到 `/` 並保留目前頁面為 `next`。

頁面載入時會呼叫：

- `GET /api/subscription`

若 API 回傳 `ai_usage`，共用 `apiFetch()` 會自動更新 AI 用量標籤。標籤 hover title 會包含 calls、input tokens、output tokens、total tokens、cost 與使用模型。

### 2.4 Toast 與錯誤處理

所有頁面使用同一套 toast：

- 成功訊息顯示黑底 toast。
- 錯誤訊息顯示紅底 toast。
- `apiFetch()` 會解析 JSON，若 `success: false` 或 HTTP 非 2xx，就丟出錯誤。
- `userFacingErrorMessage()` 會把常見 JavaScript 技術錯誤轉成使用者可理解的提示。

全域也監聽：

- `window.error`
- `unhandledrejection`

因此非同步錯誤會用 toast 顯示，不會讓頁面整個白屏。

### 2.5 全部重置

總覽與資料中心都有重置按鈕，透過 `data-reset-workspace` 綁定共用 `resetWorkspace()`。

操作流程：

1. 顯示確認視窗。
2. 使用者確認後呼叫 `POST /api/reset`。
3. 清除資料來源、整理結果、分析結果、Brand DNA、處理紀錄與成果。
4. 保留品牌基本資料與目前方案。
5. Cloudflare 版不清除 `usage_events`，避免靠 reset 繞過用量限制。
6. 完成後 reload 畫面。

### 2.6 D1 / R2 / Artifact 概念

儀表板上的文字資料、狀態、jobs、Brand DNA 與成果 metadata 主要保存於 D1。

檔案、圖片、原始資料與生成圖片保存於 R2。前端若要讀取 artifact，使用：

```text
GET /artifacts/:filename
```

API Worker 會從 D1 找 metadata，再從 R2 讀 object 並回傳。

## 3. 總覽頁 `/`

總覽頁的目標是讓使用者一眼知道目前 BrandDNA 專案是否已有足夠資料、Brand DNA 是否可用、最近有哪些成果，以及下一步該做什麼。

頁面載入時呼叫：

```text
GET /api/overview
```

並用回傳的 `summary`、`todos`、`recent_artifacts`、`sources` 與 `subscription` 更新畫面。

### 3.1 指標列

上方有四個指標卡：

- 「資料來源」：`summary.data_sources_count`。
- 「已整理」：`summary.extracted_count`。
- 「已分析」：`summary.analyses_count`。
- 「成果總數」：`summary.generated_content_count`。

這四個數字用於判斷資料流程進度。理想狀態是資料來源、已整理、已分析數字接近，且 Brand DNA 已建立。

### 3.2 工作流區塊

「工作流」區塊提供四個流程入口：

- 「資料中心」：前往 `/data-hub`，新增、整理與分析品牌資料。
- 「品牌診斷／品牌角色」：前往 `/diagnosis`，檢視 12 品牌人格與角色設定。
- 「圖文生成」：前往 `/generate`，產生 IG / FB 貼文與圖片概念圖。
- 「市場預測」：前往 `/simulation`，比較客群接受度。

區塊右上有兩個按鈕：

- 「全部重置」：呼叫 `POST /api/reset`。
- 「更新」：重新呼叫 `GET /api/overview`。

### 3.3 品牌角色區塊

此區顯示目前 active Brand DNA：

- 若尚未建立，狀態顯示「尚未建立」，並提示到資料中心新增資料與建立品牌角色。
- 若已建立，狀態顯示「可用」，並顯示角色名稱、描述、核心客群、品牌語氣與關鍵特質。

資料來源是 `summary.brand_dna`，主要讀取：

- `brand_character.name`
- `brand_character.description`
- `brand_character.target_audience`
- `brand_character.voice`
- `brand_character.traits`
- `brand_archetype.role_name`
- `keywords`

### 3.4 待辦區塊

「待辦」區塊顯示 `GET /api/overview` 回傳的 `todos`。

每筆待辦包含：

- 優先級標籤，例如重要、待處理、建議、完成。
- 待辦文字。
- 點擊後前往對應頁面，例如資料中心、診斷或生成頁。

待辦通常用來提醒：

- 尚未新增資料。
- 來源還沒整理或分析。
- Brand DNA 尚未建立。
- 可以開始生成內容或做市場預測。

### 3.5 最近成果區塊

此區顯示最近 artifact：

- 成果標題。
- 成果類型，例如文案成果、品牌圖片、診斷報告、規範檢查、模擬。
- 建立時間。
- 摘要。

右上「前往生成」會連到 `/generate`。

### 3.6 資料來源區塊

此區顯示目前資料來源列表摘要：

- 來源標題。
- 來源類型。
- 最新整理狀態。
- 最新分析狀態。

右上「管理」會連到 `/data-hub`。

## 4. 資料中心 `/data-hub`

資料中心是整個系統最重要的資料入口。它負責把原始資料變成可分析的來源，並進一步建立 Brand DNA。

頁面載入時同時呼叫：

```text
GET /api/overview
GET /api/sources
GET /api/jobs
GET /api/logs?limit=50
```

### 4.1 上方指標列

四個指標：

- 「資料來源」：來源總數。
- 「已整理」：已完成 extraction 的來源數。
- 「已分析」：已完成 analysis 的來源數。
- 「品牌角色」：顯示「已建立」或「尚未」。

### 4.2 資料輸入區塊

左側第一個大卡片是「1. 資料輸入」。它支援批次輸入與單一來源送出。

右上按鈕：

- 「重設工作區」：呼叫全域 reset。
- 「新增其他資料」：展開或收合「手動輸入備案」。

系統要求至少填寫 3 種有效來源，才會啟用「送出全部可用來源」。法律規範與內部規範會隨批次分析，但不計入 3 種來源門檻。

#### 4.2.1 Instagram 來源卡

用途：輸入貼文、公告與日常互動資料。

可用模式：

- 「自動擷取 URL」：填入 Instagram URL，按「確認擷取」呼叫 `POST /api/global-scan/social-preview`，嘗試回填 5 篇公開貼文。
- 「手動輸入」：填寫 5 篇貼文內容，且每篇都需上傳一張圖片。

主要按鈕：

- 「填寫來源示範」：開啟示範案例選單，可填入示範文字與圖片。
- 「展開 / 收合」：展開或收合此來源卡。
- 「確認擷取」：只在 URL 模式中使用，先做社群預覽。
- 「送出此來源」：呼叫 `POST /api/source-input/instagram/submit`。

展示建議：Instagram / Facebook 自動擷取受平台限制，最穩定的展示主流程是手動輸入 5 篇貼文與圖片，或使用示範資料。

#### 4.2.2 Facebook 來源卡

用途：輸入營業公告、社群長文與熟客提醒。

行為與 Instagram 類似：

- URL 模式可嘗試公開頁擷取與回填。
- 手動模式要求 5 篇貼文內文與 5 張圖片。
- 「送出此來源」呼叫 `POST /api/source-input/facebook/submit`。

Facebook 不使用登入或粉專 API。若公開頁無法抓取，應轉用手動輸入。

#### 4.2.3 官網來源卡

用途：輸入品牌故事、菜單、門市、公告與官網文案。

可用模式：

- 「自動擷取 URL」：填入官網 URL。
- 「手動輸入」：貼上官網重點文字。

主要按鈕：

- 「送出此來源」呼叫 `POST /api/source-input/website/submit`。

Cloudflare 版後端以 fetch-first 為主，並受成本限制保護。UI 可能顯示較完整的探索說明，但 Worker 端仍會依展示版限制控制頁數、時間與內容大小。

#### 4.2.4 Google 商家/地圖來源卡

用途：輸入商家資訊、地點、評論脈絡與公開地圖頁內容。

可用模式：

- URL 模式：填入 Google Maps 或商家 URL。
- 手動模式：貼上商家資訊或評論摘要。

「送出此來源」呼叫：

```text
POST /api/source-input/google_maps/submit
```

若平台擷取失敗，不應中斷整個 pipeline，應用手動內容補足。

#### 4.2.5 招募人才網站來源卡

用途：輸入職缺、文化、能力條件與工作節奏。

可用模式：

- URL 模式：填入 104、1111 或公開招募頁 URL。
- 手動模式：貼上職缺、品牌文化或人才需求文字。

「送出此來源」呼叫：

```text
POST /api/source-input/recruitment/submit
```

招募資料對 Brand DNA 很重要，因為它會揭露品牌內部語氣、服務標準、工作節奏與組織文化。

### 4.3 法律規範與內部規範

資料輸入區底部有兩個規範資料區。

「店家認為需要遵守的法律規範」提供多選 checkbox：

- 食品安全衛生管理法。
- 食品良好衛生規範準則。
- 食品安全管制系統準則。
- 食品添加物使用範圍及限量暨規格標準。
- 消費者保護法。
- 公平交易法 / 網路廣告不實相關規範。
- 個人資料保護法 / 施行細則。
- 勞動基準法。
- 職業安全衛生法。
- 廢棄物清理法。

「店家內部既有規範」是文字區，可填入：

- 禁用誇大療效字眼。
- 回覆評論語氣。
- 員工服務規範。
- 品牌禁語。
- 活動與折扣限制。

這些規範會隨 `POST /api/global-scan/run` 一起送出，成為後續風險檢查與內容生成的參考脈絡。

### 4.4 送出全部可用來源

「送出全部可用來源」按鈕預設 disabled。當有效來源達到 3 種時才啟用。

按下後：

1. 前端收集 `globalScanForm`。
2. 將已勾選法律規範 append 到 `selected_rules`。
3. 將內部規範寫入 `internal_rules`。
4. 呼叫 `POST /api/global-scan/run`。
5. 後端建立 raw sources、整理資料、分析資料，並回傳建立結果。
6. 前端更新來源、jobs、logs、Brand DNA 狀態。

若其中某個外部平台擷取失敗，前端會顯示 toast 與來源卡狀態，但其他成功來源仍可保留。

### 4.5 手動輸入備案

點「新增其他資料」會展開手動輸入表單。

欄位：

- 「資料類型」：Instagram、Facebook、Google 商家/地圖、Google 評論、官網 / 品牌頁、招募內容、法律規範、內部規範、其他資料。
- 「標題」：來源名稱。
- 「URL」：來源網址，可留空。
- IG / FB 特殊欄位：5 篇貼文內文與 5 張圖片。
- 一般文字內容：貼上文字、評論、貼文或規範內容。
- 檔案 / 圖片：支援 txt、md、csv、json、html、pdf、docx、xlsx、xls、pptx 與常見圖片格式。

按「新增手動資料」會呼叫：

```text
POST /api/sources
```

IG / FB 手動資料會先驗證 5 篇貼文與圖片是否完整。一般資料則可送文字或檔案。

### 4.6 來源處理區塊

中間卡片是「2. 來源處理」。

右上「重新整理」會重新呼叫：

```text
GET /api/overview
GET /api/sources
GET /api/jobs
GET /api/logs?limit=50
```

`workflowHint` 會依目前狀態提示：

- 尚未建立資料來源。
- 還有來源未整理。
- 還有來源未分析。
- 來源已就緒，請建立品牌角色。
- 流程完成，可前往診斷或生成。

每筆來源 row 顯示：

- 來源標題。
- 來源類型。
- 來源編號。
- input kind，例如文字、URL、檔案、圖片。
- 批次輸入編號。
- 是否為手動補資料。
- 整理狀態。
- 分析狀態。
- 錯誤訊息。

主要按鈕：

- 「整理內容 / 重新整理」：呼叫 `POST /api/sources/:source_id/extract`。
- 「分析來源 / 重新分析」：呼叫 `POST /api/sources/:source_id/analyze`。只有整理完成後才能按。
- 「手動補資料」：當整理狀態是 `error` 或 `needs_manual_text` 時啟用。
- 「彙整版」：分析完成後可展開 LLM 彙整版。
- 「送出補資料並分析」：呼叫 `POST /api/sources/:source_id/fallback`，body 包含 `content` 與 `analyze: true`。

彙整版會顯示：

- source summary。
- 分數或維度。
- 關鍵字。
- 語氣特徵。
- 圖片觀察。
- 風險或缺口。
- 內容機會。

### 4.7 品牌角色區塊

右側卡片是「3. 品牌角色」。

按「重新建立品牌角色」會呼叫：

```text
POST /api/pipeline/run
```

Pipeline 會整合已整理與已分析的來源，建立或更新 Brand DNA snapshot。

此區顯示：

- 目前使用中的品牌角色。
- 角色描述。
- 角色關鍵特質。
- 處理紀錄：`GET /api/jobs`。
- 系統紀錄：`GET /api/logs?limit=50`。

系統紀錄會同步寫入 Cloudflare D1 `system_logs`，也可依設計寫入 R2 logs。

## 5. 品牌診斷／品牌角色 `/diagnosis`

此頁負責把 Brand DNA 轉成可讀的診斷畫面，包含資料準備程度、12 品牌人格、品牌角色設定與角色圖。

載入時呼叫：

```text
GET /api/overview
```

若 `overview.latest_diagnosis.payload` 存在，使用最新診斷 artifact；否則由 `summary.brand_dna` 即時計算基本顯示。

### 5.1 品牌資料準備

「1. 品牌資料準備」顯示：

- `scanScore`：完成度百分比。
- `sourceBreakdown`：各來源類型筆數。
- `readinessFill`：完成度進度條。
- `sourceTotal`：資料筆數。

完成度通常以已分析來源占總來源的比例計算。它讓使用者知道目前診斷基礎是否足夠。

### 5.2 12 品牌人格

「2. 12 品牌人格」用來呈現 Brand Archetype。

主要元素：

- 品牌人格圖示：讀 `/static/archetypes/*.svg`。
- 主要人格名稱：例如凡人型、照顧者型、創造者型。
- 信心分數：顯示百分比。
- 判斷理由：來自 Brand DNA 或診斷結果。
- 前五名人格排名：每個人格可展開看詳細說明。
- 其餘七個人格分數：收合在 `details` 中。

十二種人格：

- 天真者型品牌。
- 探險家型品牌。
- 智者型品牌。
- 英雄型品牌。
- 叛逆者型品牌。
- 魔法師型品牌。
- 凡人型品牌。
- 愛人型品牌。
- 小丑型品牌。
- 照顧者型品牌。
- 創造者型品牌。
- 統治者型品牌。

若 API 沒有提供完整 reasoning，前端會用 Brand DNA 的定位、特質、語氣與客群推導出較可讀的說明，避免畫面只顯示空白或泛用文字。

### 5.3 品牌角色設定

「3. 品牌角色設定」顯示：

- 品牌定位。
- 品牌特色。
- 品牌語氣。
- 視覺個性。
- 核心客群。

右上「重新診斷」按鈕呼叫：

```text
POST /api/diagnosis/insights
```

成功後：

1. 取得新的 diagnosis insight。
2. 再呼叫 `GET /api/overview`。
3. 更新畫面。
4. 顯示診斷 artifact 編號。

### 5.4 品牌角色圖

底部左側是品牌角色圖區。

若尚未產生角色圖：

- 顯示主要品牌人格的 SVG 作為占位圖。
- 按鈕顯示「產生角色圖」。

若已產生角色圖：

- 顯示 R2 / artifact 圖片。
- 按鈕改為「重新產生角色圖」。
- Image prompt 預覽可展開。

按「產生角色圖」的流程：

1. 確認 Brand DNA 已建立。
2. 呼叫 `POST /api/brand-character-image-prompt` 產生角色圖提示詞。
3. 顯示 prompt 預覽。
4. 呼叫 `POST /api/generate-brand-character-image`，body 包含 prompt、size 與 quality。
5. 圖片存到 R2，metadata 寫入 D1 artifact。
6. 重新呼叫 `GET /api/overview`，把圖片寫回 Brand DNA 顯示。

### 5.5 診斷狀態

右側「診斷狀態」顯示：

- 資料來源數。
- 已整理數。
- 已分析數。
- 品牌角色是否可用。

「匯入示範資料」按鈕呼叫：

```text
POST /api/case/import
```

此 endpoint 是 `/api/demo/import` 的相容別名，用於快速匯入展示資料。

## 6. 圖文生成 `/generate`

此頁用 Brand DNA 產出社群貼文與品牌圖片概念圖。核心目標是讓使用者輸入行銷需求後，得到一組可發佈前檢查的 IG / FB 貼文草稿。

載入時會呼叫：

```text
GET /api/overview
POST /api/marketing-demand-suggestions
GET /api/generation-history
GET /api/latest-generated-post
```

### 6.1 規範與需求

左上卡片「1. 規範與需求」包含：

- 「平台」下拉選單：Instagram 或 Facebook。
- 「行銷需求」文字區：輸入這次要生成的活動、商品、客群、語氣或目的。
- 行銷需求建議 chips：由 `POST /api/marketing-demand-suggestions` 產生，點擊後自動填入需求文字。
- 「常見法規」文字區：每行一項。
- 「自訂禁用詞」文字區：每行一詞。
- 「公司內部規範」文字區。
- 「特殊行銷規範」文字區。

「生成整組貼文」按鈕會先驗證行銷需求不可空白。

### 6.2 生成整組貼文流程

按「生成整組貼文」後：

1. 呼叫 `POST /api/generate-content`。
2. Request body 包含：
   - `content_type`
   - `context`
   - `legal_rules`
   - `forbidden_words`
   - `internal_rules`
   - `marketing_rules`
3. Worker 讀取 active Brand DNA。
4. OpenAI 生成平台文案、hashtag、規範說明與 image prompt。
5. 成果寫入 D1 artifacts。
6. 前端更新手機預覽。
7. 接著呼叫 `POST /api/generate-brand-image`。
8. 圖片存入 R2。
9. 前端把概念圖顯示在手機預覽媒體區。

此流程會連續消耗文案與圖片 quota，因此右側用量區會同步更新。

### 6.3 品牌角色與核心客群

左下卡片顯示目前 Brand DNA 摘要：

- 角色名稱。
- 角色描述或定位。
- 核心客群。
- 品牌語氣。
- 品牌特質標籤。

右上「查看角色」連到 `/diagnosis`。

下方「現階段常見客群」展開後顯示常見客群：

- 年輕上班族。
- 家庭客。
- 大學生。
- 社群追蹤者。

這些客群可協助使用者思考行銷需求，但生成主要仍以 Brand DNA 和輸入需求為準。

### 6.4 最終社群貼文

中間是手機樣式預覽。

包含：

- 品牌 avatar。
- 品牌名稱。
- 平台名稱。
- 媒體預覽區。
- caption 預覽區。

右上按鈕：

- 「複製」：把最新文案寫入 clipboard。
- 「送市場預測」：把最新文案寫入 `sessionStorage.draftForSimulation`，再跳到 `/simulation`。

若尚未生成，caption 顯示「尚未生成貼文」。若有最新成果，頁面會自動還原最近一筆。

### 6.5 用量區塊

右上「用量」卡片顯示：

- 目前方案。
- 文案 quota 使用量。
- 圖片 quota 使用量。
- 對應進度條。

它會隨 `subscriptionChanged` 事件更新。

### 6.6 產出狀態與產出紀錄

右下卡片顯示：

- 成果狀態，例如「尚未生成」或「成果 #id」。
- 平台。
- 最終文案。
- hashtags。
- 規範狀態。
- 最近 5 筆文案成果。

點擊歷史項目會呼叫：

```text
GET /api/generation-detail/:identifier
```

如果點到文案成果，會還原文案；如果有配對圖片，會再載入圖片 artifact。圖片 URL 可能是 artifact file_url，也可能由 `/artifacts/:filename` 解析。

## 7. 規範守門員 `/gatekeeper`

規範守門員用於檢查文案是否違反法律、品牌內規或禁用詞，並產生安全改寫版本。

載入時呼叫：

```text
GET /api/overview
GET /api/generation-history
```

### 7.1 規範設定

左側「規範設定」包含：

- 功能方案標籤 `AIR+`。
- 功能可用提示。
- 三個預設法規 checkbox：
  - 消費者保護法。
  - 食品安全衛生管理法。
  - 公平交易法。
- 自訂禁用詞 input。
- 「新增」按鈕。
- 禁用詞 tag 列表。
- 自訂規範資料 textarea。
- 「存成品牌規範」按鈕。

預設禁用詞：

- 保證有效。
- 100%最好。
- 療效。
- 絕對。

「新增」會把 input 文字加入禁用詞列表。每個禁用詞 tag 內有小型關閉按鈕，可移除該詞。

「存成品牌規範」會呼叫：

```text
POST /api/sources
```

並送出：

```json
{
  "source_type": "compliance_rule",
  "title": "自訂規範",
  "content": "..."
}
```

這會把規範存成資料來源，讓後續分析與生成流程可以使用。

### 7.2 檢測來源

第二欄「檢測來源」包含：

- 「讀取草稿」按鈕。
- 文案草稿下拉選單。
- 文案輸入 textarea。
- 「高風險範例」按鈕。
- 「低風險範例」按鈕。
- 「開始檢測」按鈕。

「讀取草稿」呼叫 `GET /api/generation-history`，只列出 `content_generation` 類型成果。

選擇草稿後呼叫：

```text
GET /api/generation-detail/:identifier
```

並把文案填入 textarea。

高風險範例會填入含「保證100%有效」的文案；低風險範例會填入一般週末套餐文案。

### 7.3 開始檢測

按「開始檢測」後：

1. 驗證文案不可空白。
2. 取得已勾選的法規。
3. 取得禁用詞列表。
4. 呼叫 `POST /api/risk-check`。
5. Worker 讀取 Brand DNA 與規範脈絡。
6. OpenAI 產生風險等級、違規點、安全改寫與合規判斷。
7. 結果寫入 D1 artifacts。
8. 前端更新檢測結果、安全改寫、合規檢核與歷史。

Request body：

```json
{
  "content": "...",
  "custom_rules": ["..."],
  "forbidden_words": ["..."]
}
```

### 7.4 檢測結果

第三欄「檢測結果」顯示：

- 風險標籤：低風險、需留意、高風險。
- 安全分數儀表：
  - high 對應較低分。
  - medium 對應中等分。
  - low 對應高分。
- 違規項目卡片：
  - issue。
  - location。
  - suggestion。

若沒有明顯違規，顯示「未發現明顯違規風險」。

### 7.5 安全改寫與歷史

第四欄包含：

- 「安全改寫」文字。
- 「複製」按鈕。
- 「合規檢核」列表。
- 「檢測歷史」列表。

「複製」會將最新 safe content 寫入 clipboard。

合規檢核目前顯示：

- 無醫療效果宣稱。
- 無絕對化用語。
- 價格標示合規。
- 符合公司規範。

檢測歷史從 `GET /api/generation-history` 讀取 `risk_check` 類型 artifact。點擊歷史會呼叫 `GET /api/generation-detail/:identifier`，還原輸入與結果。

## 8. 市場預測 `/simulation`

市場預測用於把已生成的社群文案拿去對不同客群做接受度模擬，輸出各客群的吸引原因、正向反應與最佳前二名。

載入時呼叫：

```text
GET /api/overview
GET /api/generation-history
```

### 8.1 選擇客群

左側「1. 選擇客群」包含：

- 功能方案標籤 `AIR+`。
- 功能可用提示。
- 客群來源說明。
- 分析客群列表。
- 常見客群面板。

頁面會優先從 Brand DNA 讀取 `audience_segments`：

- 若有分析客群，預設全選。
- 若沒有分析客群，會嘗試使用 `brand_character.target_audience`。
- 若仍沒有，提示使用者從常見客群加入。

每個客群 row 有：

- checkbox：是否納入預測。
- icon。
- 客群名稱。
- 客群說明。
- 移除按鈕。

「常見客群」可展開加入：

- 年輕上班族。
- 家庭客。
- 大學生。
- 社群追蹤者。

若常見客群已存在，按鈕會顯示「已加入」並 disabled。

### 8.2 選擇社群文案

中間「2. 選擇社群文案」包含：

- 「讀取文案」按鈕。
- 已生成文案下拉選單。
- selected content preview。
- 「開始市場預測」按鈕。
- prediction result 區。

「讀取文案」呼叫：

```text
GET /api/generation-history
```

並只列出 `content_generation` 類型成果。

選擇文案後呼叫：

```text
GET /api/generation-detail/:identifier
```

前端讀取：

- `payload.final_caption`
- 或 `payload.generated_content[0]`

若使用者從 `/generate` 按「送市場預測」，文案會透過 `sessionStorage.draftForSimulation` 自動帶入此頁，不必再手動選擇。

### 8.3 開始市場預測

按「開始市場預測」後：

1. 驗證已選文案。
2. 驗證至少勾選一個客群。
3. 呼叫 `POST /api/simulate`。
4. Request body 包含：
   - `content`
   - `audiences`
5. Worker 讀 Brand DNA、文案與客群資料。
6. OpenAI 產生接受度預測。
7. 結果寫入 D1 artifacts。
8. 前端更新結果、前二名與歷史。

### 8.4 預測結果

中間結果區顯示每個客群：

- 客群名稱。
- 正向接受度百分比。
- 進度條。
- 吸引原因。
- 正向反應。

右側「最佳目標客群前二名」顯示：

- overall score。
- 第 1 名與第 2 名。
- 每個客群的推薦原因。

若尚未預測，顯示「尚未判斷最佳目標客群」。

### 8.5 預測歷史

預測歷史讀取 `simulation` 類型 artifact。

點擊歷史項目會：

1. 呼叫 `GET /api/generation-detail/:identifier`。
2. 還原 input 文案。
3. 呼叫 `renderPrediction()` 顯示歷史結果。

## 9. 主要資料狀態

前端常見狀態標籤如下：

- `not_extracted`：尚未整理。
- `not_analyzed`：尚未分析。
- `stored`：已新增。
- `extracted`：已整理。
- `analyzed`：已分析。
- `done`：已完成。
- `running`：處理中。
- `queued`：等待中。
- `error`：需要處理。
- `failed`：未完成。
- `needs_manual_text`：需要補充文字。

資料中心的來源處理通常經過：

```text
raw source created
  -> extraction_results: extracted / needs_manual_text / error
  -> analysis_results: analyzed / error
  -> brand_dna_snapshots: active snapshot
```

若 extraction 失敗或檔案類型無法在 Cloudflare Worker 中直接解析，狀態會變成 `needs_manual_text`，使用者可按「手動補資料」貼上文字。

## 10. 主要 API 對照

共用：

- `GET /api/health`：健康檢查。
- `GET /api/brand`：讀品牌基本資料。
- `GET|POST /api/subscription`：讀取本次 request 的方案與用量；POST 只回傳指定方案狀態，不保存帳號或會員狀態。
- `POST /api/reset`：重置工作區。

總覽：

- `GET /api/overview`

資料中心：

- `POST /api/demo/import`
- `POST /api/case/import`
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

Brand DNA 與診斷：

- `GET|POST /api/brand-dna`
- `POST /api/brand-dna/override`
- `POST /api/diagnosis/insights`
- `POST /api/brand-character-image-prompt`
- `POST /api/generate-brand-character-image`

圖文生成：

- `GET /api/generation-history`
- `GET /api/generation-detail/:identifier`
- `GET /api/latest-generated-post`
- `POST /api/marketing-demand-suggestions`
- `POST /api/generate-content`
- `POST /api/generate-brand-image`

規範守門員：

- `POST /api/risk-check`

市場預測：

- `POST /api/simulate`

Artifacts：

- `GET /artifacts/:filename`

## 11. 成本與用量邏輯

Cloudflare Demo Edition 以低成本展示為優先，因此功能雖保留，但後端有硬限制。

目前設計重點：

- 單檔上傳限制 5MB；展示版檔案使用既有 D1 分塊保存。
- 網站擷取有頁數、時間與單頁內容大小限制。
- 社群平台不承諾完整自動爬取，保留手動 5 篇貼文與圖片作穩定主流程。
- 圖片生成每次最多 1 張。
- OCR / image input 有數量限制。
- OpenAI key 僅在 Worker secret，不進前端。
- 每次 AI 呼叫記錄 model、feature、input / output size 或 tokens、created_at。
- `/api/reset` 不清除 usage events。
- FREE / AIR / PRO quota 以本次 session run 計算，會反映在 UI，Worker 端仍會檢查硬限制。

前端看到的 quota 是提示與操作引導；真正防止濫用的是 Worker 端 session/run quota、全站 weekly hard limit 與 Cloudflare 平台設定。

## 12. 建議展示腳本

如果要向評審或主辦單位展示，建議按以下節奏：

1. 開 `/` 選擇方案，再進總覽，說明目前 BrandDNA 是 Cloudflare-first demo，資料、AI 與成果都在雲端保存。
2. 進資料中心，用「填寫來源示範」快速填入 Instagram、Facebook、官網或 Google 商家資料。
3. 說明自動擷取與手動 fallback 都存在，社群平台以手動 5 篇貼文 + 圖片作穩定展示流程。
4. 按「送出全部可用來源」，等待來源進入已整理與已分析。
5. 按「重新建立品牌角色」，說明 D1 保存 Brand DNA snapshot。
6. 進品牌診斷，展示 12 品牌人格、角色設定與角色圖生成。
7. 進圖文生成，輸入一段行銷需求，按「生成整組貼文」。
8. 展示手機預覽、caption、hashtag、規範狀態與圖片概念圖。
9. 進規範守門員，讀取剛才草稿或貼上高風險範例，展示違規點與安全改寫。
10. 進市場預測，選客群與文案，展示接受度與最佳前二名。

## 13. 審查者可理解的產品價值

此儀表板的核心價值在於把分散資料變成可操作的品牌決策流程：

- 資料中心把社群、官網、地圖、招募、規範整理成結構化來源。
- Brand DNA pipeline 把來源分析成品牌人格、語氣、定位、客群與內容機會。
- 圖文生成直接使用 Brand DNA，不是只做通用文案。
- 規範守門員把品牌內規、法規與禁用詞納入檢查。
- 市場預測把文案拿去比較不同客群反應。

因此它不是單一生成工具，而是一個品牌經營工作流 demo。
