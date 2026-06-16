# BrandDNA Analytics Platform 系統介紹

文件日期：2026-05-26  
適用版本：目前 `demo` 專案中的 Flask / SQLite 本機展示版

## 1. 文件目的

本文件說明 BrandDNA Analytics Platform 的系統定位、使用情境、功能模組、資料流程、技術架構、API、資料表、AI 任務、環境設定與維運注意事項。它適合以下角色閱讀：

- 競賽評審或簡報聽眾：快速理解系統解決什麼問題、如何運作、展示價值在哪裡。
- 開發者：掌握專案結構、資料流、API 與核心函式，方便維護與擴充。
- 產品或企劃角色：理解各頁面功能、使用流程、訂閱方案與未來可延伸方向。
- 測試與展示人員：知道如何啟動、匯入示範資料、執行主要流程與檢查結果。

## 2. 系統一句話定位

BrandDNA Analytics Platform 是一個面向中小型餐飲與零售品牌的 AI 品牌經營工作台。系統會蒐集品牌公開資料、社群貼文、顧客評論、官網、招募資訊與內部規範，整理成可被 AI 分析的原始證據，再產出品牌 DNA、品牌診斷、行銷文案、品牌圖像企劃、合規風險檢測與 Persona 市場模擬。

目前專案是本機 Demo 版，預設示範品牌為台式早午餐品牌 `沒事早事坐`，品牌代號為 `zao_shih`。

## 3. 核心價值

傳統中小品牌經營常見痛點：

- 品牌語氣仰賴老闆或小編經驗，缺少可重複使用的品牌準則。
- 社群、評論、官網、招募資訊分散，難以整合成一致的品牌洞察。
- 生成式 AI 可以寫文案，但若沒有品牌上下文，很容易產出空泛、跑調或不合規內容。
- 餐飲業文案常涉及療效、保證、限時優惠、食安宣稱與比較式廣告，合規風險需要前置檢查。
- 品牌想知道不同客群如何反應，但缺少快速、低成本的前測工具。

本系統以「資料輸入 -> 來源整理 -> 品牌 DNA -> 生成與檢測 -> 模擬回饋」串成一條可展示、可反覆執行的流程，使 AI 生成不再只是單次聊天，而是建立在品牌證據與規則之上的營運工具。

## 4. 使用者情境

### 4.1 品牌主或小型店家

店家可以輸入自家官網、Instagram、Facebook、Google 商家、招募頁，或直接貼上文字與上傳檔案。系統會整理資料並產生品牌 DNA，後續店家只要輸入行銷需求，就能生成符合品牌語氣的貼文、公告或商家更新。

### 4.2 行銷企劃或社群小編

行銷人員可以把品牌 DNA 當作固定的創作基礎，快速產出多版文案、視覺企劃、圖片生成 prompt，再把結果送到規範守門員檢查，降低不合品牌或不合規的風險。

### 4.3 顧問或品牌診斷角色

顧問可以用資料中心建立資料來源，以品牌診斷頁查看品牌人格、趨勢機會、競爭落差、改善優先順序與品牌角色，作為工作坊、提案或策略討論的基礎。

### 4.4 競賽展示

展示人員可以匯入 `examples/demo_sources` 中的範例資料，快速跑完整流程：資料中心 -> 建立品牌 DNA -> 品牌診斷 -> 圖文生成 -> 規範守門員 -> 市場模擬。

## 5. 高階流程

系統主流程如下：

1. 建立或讀取預設品牌。
2. 使用者新增資料來源，可為 URL、文字、檔案、圖片或社群貼文組合。
3. 系統將來源存入 SQLite，原始檔案存到 `runtime/rawdata`。
4. 系統執行內容整理：
   - URL 來源使用 Playwright 擷取公開頁面與截圖。
   - 純文字來源直接讀取。
   - PDF、DOCX、XLSX、XLS、PPTX 轉成文字。
   - 圖片透過 OpenAI 視覺模型做 OCR 與內容描述。
5. 系統針對每個來源做 AI 分析，產出摘要、人格分數、關鍵字、語氣標記、視覺證據、風險缺口與內容機會。
6. 系統彙整多個來源分析，建立 Brand DNA snapshot。
7. 使用 Brand DNA 支援後續功能：
   - 品牌診斷洞察。
   - 行銷文案生成。
   - 品牌圖片企劃與圖片生成。
   - 合規與品牌守門員。
   - Persona 市場模擬。
8. 所有工作與輸出會存入 `jobs`、`artifacts`、`system_logs` 等表，方便 UI 呈現歷史紀錄與除錯資訊。

## 6. 目前示範品牌

系統在 `src/branddna/app.py` 中定義預設品牌：

- 品牌代號：`zao_shih`
- 品牌名稱：`沒事早事坐`
- 類別：台式早午餐
- 地點：台北市
- 描述：示範用餐飲品牌，用於 BrandDNA 分析、內容生成與風險檢查流程。

此 Demo 目前以單一品牌、單一 Demo 帳戶為主，適合本機展示與驗證流程。

## 7. 主要功能模組

### 7.1 總覽

路徑：`/`

總覽頁是系統入口，呈現：

- 資料來源數量。
- 已整理來源數量。
- 已分析來源數量。
- 已產出內容或 artifacts 數量。
- 目前 Brand DNA 狀態。
- 待辦事項。
- 最近產出成果。
- 最近資料來源。
- 快速前往資料中心、品牌診斷、圖文生成、規範守門員與市場模擬。
- 重設工作區按鈕。

總覽頁主要讀取 `GET /api/overview`。

### 7.2 資料中心

路徑：`/data-hub`

資料中心負責資料輸入、整理、分析與 Brand DNA 建立，是整個系統的起點。主要能力如下：

- 輸入公開 URL：
  - Instagram。
  - Facebook。
  - 官網。
  - Google 商家 / 地圖。
  - 招募網站。
- 針對 Instagram / Facebook 支援社群貼文自動預覽。
- 支援手動輸入社群貼文，每個社群來源需要 5 篇貼文內容與 5 張圖片。
- 支援一般手動文字、URL 與檔案上傳。
- 支援店家勾選法規規範。
- 支援店家輸入內部既有規範。
- 對單一來源執行：
  - 整理內容。
  - 分析來源。
  - 手動補資料。
  - 查看原文。
  - 查看 AI 彙整版。
- 對所有來源重新建立 Brand DNA。
- 查看處理紀錄與系統紀錄。

資料中心是最重要的資料品質控制介面，因為後續所有 AI 輸出都依賴這裡建立的來源證據。

### 7.3 品牌診斷

路徑：`/diagnosis`

品牌診斷頁負責把 Brand DNA 與已分析來源轉成決策型洞察。頁面包含：

- 來源完整度與資料準備度。
- 品牌人格定位。
- 五大人格維度：
  - 真誠。
  - 活力。
  - 專業。
  - 真實。
  - 競爭力。
- 市場趨勢關鍵字與內容機會。
- 對標與差距分析。
- 改善優先順序。
- 品牌角色、語氣、風格標籤與應用情境。
- 可手動觸發重新建立 Brand DNA。
- 可產生或刷新診斷洞察。
- 可依品牌角色產生角色圖提示詞與直式角色圖。

品牌診斷主要使用：

- `GET /api/overview`
- `POST /api/pipeline/run`
- `POST /api/diagnosis/insights`
- `POST /api/brand-character-image-prompt`
- `POST /api/generate-brand-character-image`

### 7.4 圖文生成

路徑：`/generate`

圖文生成頁把 Brand DNA 應用在行銷內容產出。主要能力：

- 輸入自然語言行銷需求。
- 選擇內容類型：
  - Instagram 貼文。
  - Facebook 貼文。
- 可載入行銷需求建議。
- 套用常見法規、自訂禁用詞、公司內部規範與特殊行銷規範。
- 讀取品牌角色與核心客群。
- 生成品牌文案。
- 產生圖片企劃 prompt。
- 依企劃生成圖片。
- 手機預覽品牌貼文。
- 複製最新文案。
- 將文案送到規範守門員。
- 將文案送到市場模擬。
- 查看生成歷史。

主要 API：

- `POST /api/generate-content`
- `POST /api/marketing-demand-suggestions`
- `POST /api/generate-personality-prompt`
- `POST /api/generate-brand-image`
- `GET /api/generation-history`
- `GET /api/generation-detail/<identifier>`
- `GET /api/latest-generated-post`

### 7.5 規範守門員

路徑：`/gatekeeper`

規範守門員用於檢查文案的合規與品牌風險。主要能力：

- 勾選常見規範：
  - 消費者保護法。
  - 食品安全衛生管理法。
  - 公平交易法。
- 新增自訂禁用詞。
- 貼上公司行銷規範或特殊法規摘要。
- 從生成草稿讀取內容。
- 手動貼上待檢測文案。
- 使用高風險或低風險範例。
- 輸出風險等級、違規位置、建議、合規檢核與安全改寫。
- 查看檢測歷史。

主要 API：

- `POST /api/risk-check`
- `GET /api/generation-history`
- `GET /api/generation-detail/<identifier>`

### 7.6 市場模擬

路徑：`/simulation`

市場模擬用於估計不同客群對文案或活動內容的反應。它不是實際問卷，而是根據 Brand DNA、文案內容與 Persona 設定做方向性推估。

功能包含：

- 預設 Persona 清單。
- 新增自訂 Persona。
- 選擇模擬目標。
- 從生成草稿或風險檢測結果載入內容。
- 對每個 Persona 產生情緒、分數、反應、疑慮與建議。
- 產出整體分數、最佳受眾區隔與改善建議。
- 查看模擬歷史。

主要 API：

- `POST /api/simulate`
- `GET /api/generation-history`
- `GET /api/generation-detail/<identifier>`

## 8. 系統架構

### 8.1 技術組成

目前系統採本機單體架構：

- Web 框架：Flask 3。
- 前端模板：Jinja2 templates。
- 前端樣式與互動：HTML、CSS、JavaScript、Bootstrap、Font Awesome。
- API 格式：REST-like JSON API。
- 資料庫：SQLite。
- 原始資料與 artifacts：本機檔案系統。
- AI 服務：OpenAI Responses API。
- 網頁擷取：Playwright Chromium。
- 檔案解析：
  - PDF：`pypdf`。
  - DOCX：`python-docx`。
  - XLSX：`openpyxl` / `pandas`。
  - XLS：`xlrd` / `pandas`。
  - PPTX：`python-pptx`。
  - 圖片處理：`Pillow`。

### 8.2 主要程式入口

根目錄 `app.py` 是相容性啟動入口，實際 Flask app 位於 `src/branddna/app.py`。

啟動流程：

1. 根目錄 `app.py` 將 `src` 加到 `sys.path`。
2. 匯入 `branddna.app` 中的 `app` 與 `main`。
3. 若直接執行，呼叫 `main()`。
4. `main()` 檢查 `PORT`，如果預設 port 已被占用，會改用下一個 port。
5. 啟動 Flask debug server，預設 host 為 `127.0.0.1`。

### 8.3 專案目錄

```text
.
├── app.py                         # 本機啟動入口
├── requirements.txt               # Python dependencies
├── .env                           # 本機設定檔，不應提交
├── docs/                          # 文件資料夾
│   ├── README.md                  # 簡要專案說明
│   └── system_overview.md         # 系統完整介紹
├── examples/demo_sources/         # Demo 匯入資料
├── scripts/                       # 啟動腳本
├── src/branddna/
│   ├── app.py                     # 主要 Flask 應用、API、資料流程、AI 任務
│   ├── __init__.py
│   ├── static/demo_sources/       # Demo 圖片素材
│   └── templates/                 # Jinja 頁面模板
├── tests/                         # unittest 測試
└── runtime/                       # 本機執行期資料，不應視為原始碼
```

### 8.4 Runtime 目錄

系統會在啟動時建立以下目錄：

```text
runtime/
├── data/                          # SQLite database
├── rawdata/                       # 原始資料、手動文字、上傳檔案、擷取結果
├── artifacts/                     # 生成圖片、截圖、輸出 artifacts
├── uploads/                       # 上傳暫存或擴充用途
└── logs/                          # JSONL 系統紀錄
```

預設資料庫路徑為：

```text
runtime/data/app.sqlite3
```

系統紀錄檔路徑為：

```text
runtime/logs/system.log.jsonl
```

## 9. 設定檔與環境變數

系統會讀取根目錄 `.env`。目前工作目錄沒有獨立的 `.env.example` 檔，可依本節範本建立 `.env`。

### 9.1 OpenAI 金鑰

```env
OPENAI_API_KEY=your_openai_api_key
```

程式會把常見 placeholder 視為未設定，例如：

- `your_openai_api_key`
- `your-api-key`
- `your_api_key`
- `openai_api_key`
- `sk-your-key`

如果金鑰缺失或無效，系統會以使用者可讀的錯誤訊息回報，避免把完整 secret 顯示到 UI。

### 9.2 OpenAI 模型分層

系統把任務拆成多種模型設定：

```env
OPENAI_REASONING_MODEL=gpt-5.4
OPENAI_BALANCED_MODEL=gpt-5.4-mini
OPENAI_FAST_MODEL=gpt-5.4-nano
```

各任務可獨立覆寫：

```env
OPENAI_MODEL_SOURCE_ANALYSIS=gpt-5.4-mini
OPENAI_MODEL_BRAND_DNA=gpt-5.4
OPENAI_MODEL_DIAGNOSIS=gpt-5.4
OPENAI_MODEL_IMAGE_PROMPT=gpt-5.4-mini
OPENAI_MODEL_BRAND_IMAGE=gpt-5.4-mini
OPENAI_MODEL_CHARACTER_IMAGE=gpt-image-2
OPENAI_MODEL_CONTENT_GENERATION=gpt-5.4-mini
OPENAI_MODEL_MARKETING_SUGGESTIONS=gpt-5.4-nano
OPENAI_MODEL_RISK_CHECK=gpt-5.4
OPENAI_MODEL_SIMULATION=gpt-5.4-mini
OPENAI_MODEL_OCR=gpt-5.4-mini
OPENAI_MODEL_DEFAULT=gpt-5.4-mini
```

### 9.3 Reasoning effort 與 verbosity

每個 AI 任務都有 reasoning effort 與 verbosity 設定，例如：

```env
OPENAI_REASONING_BRAND_DNA=low
OPENAI_REASONING_CONTENT_GENERATION=none
OPENAI_VERBOSITY_BRAND_DNA=medium
OPENAI_VERBOSITY_CONTENT_GENERATION=medium
```

`OPENAI_REASONING_*` 可設為 `none`，此時系統不會送出 Responses API 的 `reasoning` 參數。預設只讓 Brand DNA 與風險檢查保留 low reasoning，其餘儀錶板、生成、OCR 與市場預測任務以無推理優先，以降低互動延遲。

### 9.4 Runtime 設定

```env
PORT=5000
RUNTIME_FOLDER=runtime
DEMO_DATA_FOLDER=examples/demo_sources
```

程式也支援以下路徑覆寫：

- `DATA_FOLDER`
- `RAWDATA_FOLDER`
- `ARTIFACT_FOLDER`
- `UPLOAD_FOLDER`
- `LOG_FOLDER`
- `APP_DB_PATH`

測試會用這些變數把 runtime 指到暫存資料夾，避免污染正式 demo 資料。

## 10. 資料來源設計

### 10.1 支援來源類型

系統目前定義的主要來源類型：

- `instagram`：Instagram 貼文或帳號頁。
- `facebook`：Facebook 貼文或粉專頁。
- `website`：官網、品牌頁、菜單頁、活動頁。
- `google_maps`：Google 商家 / 地圖頁。
- `google_reviews`：Google 評論。
- `recruitment`：招募網站、職缺頁、104/1111 等公開頁面。
- `compliance_rule`：店家勾選的法規規範。
- `internal_rule`：店家內部既有規範。
- `custom`：其他自訂資料來源。

### 10.2 支援輸入型態

`raw_sources.input_kind` 目前支援：

- `url`：公開網址，透過 Playwright 擷取。
- `text`：直接貼上的文字內容。
- `file`：上傳文件或表格。
- `image`：上傳圖片，透過 OpenAI 視覺能力做 OCR 與描述。

### 10.3 支援檔案格式

文字類：

- `.txt`
- `.md`
- `.markdown`
- `.csv`
- `.json`
- `.html`
- `.htm`
- `.log`

圖片類：

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.gif`
- `.bmp`
- `.tif`
- `.tiff`

文件類：

- `.pdf`
- `.docx`
- `.xlsx`
- `.xls`
- `.pptx`

### 10.4 社群手動貼文規則

Instagram 與 Facebook 的手動貼文輸入有特殊規則：

- 一次需要 5 篇貼文內容。
- 每篇貼文需要 1 張圖片。
- 系統會把圖片存到 `runtime/rawdata/manual_social_images/<source_type>`。
- 系統會把貼文文字、圖片檔名與圖片路徑組成一份文字來源，供後續 AI 分析。

這個設計讓社群資料不只保留文字，也能把圖片作為品牌視覺證據。

## 11. 資料處理流程

### 11.1 新增來源

新增來源時，系統會：

1. 判斷輸入型態。
2. 將文字或上傳檔案寫入 `runtime/rawdata`。
3. 在 `raw_sources` 建立一筆紀錄。
4. 寫入 `system_logs`，事件類型為 `source.created`。

### 11.2 內容整理

整理來源時，系統依 `input_kind` 分流：

- `url`：呼叫 `extract_url_with_playwright()`。
- `image`：呼叫 `extract_image_with_openai()`。
- `text` 或 `file`：
  - 文字格式直接讀取。
  - PDF 呼叫 `extract_pdf()`。
  - DOCX 呼叫 `extract_docx()`。
  - XLSX / XLS 呼叫 `extract_spreadsheet()`。
  - PPTX 呼叫 `extract_pptx()`。

整理結果會寫入 `extraction_results`，狀態可能為：

- `extracted`：整理成功。
- `needs_manual_text`：格式不支援或內容不足，需要人工補資料。
- `error`：整理失敗。

### 11.3 來源分析

來源分析會讀取最新成功的 `extraction_results`，將前 18,000 字左右的抽取文字與可能的圖片輸入交給 OpenAI，要求模型回傳 JSON：

```json
{
  "source_summary": "...",
  "scores": {
    "sincerity": {"score": 0, "reasoning": "..."},
    "activity": {"score": 0, "reasoning": "..."},
    "competence": {"score": 0, "reasoning": "..."},
    "authenticity": {"score": 0, "reasoning": "..."},
    "competitiveness": {"score": 0, "reasoning": "..."}
  },
  "keywords": ["..."],
  "tone_markers": ["..."],
  "visual_evidence": ["..."],
  "risks_or_gaps": ["..."],
  "content_opportunities": ["..."]
}
```

分析結果寫入 `analysis_results`。

### 11.4 Brand DNA 建立

Brand DNA 建立會讀取每個來源最新的成功分析，彙整成品牌層級輸出：

```json
{
  "brand_name": "...",
  "handle": "...",
  "archetype": "...",
  "personality_scores": {
    "sincerity": 0,
    "activity": 0,
    "competence": 0,
    "authenticity": 0,
    "competitiveness": 0
  },
  "keywords": ["..."],
  "forbidden_words": ["..."],
  "tone_guide": {
    "voice": "...",
    "sentence_style": "...",
    "emoji_usage": "...",
    "do": ["..."],
    "dont": ["..."]
  },
  "audience_segments": [
    {"name": "...", "need": "...", "message_angle": "..."}
  ],
  "content_guidelines": ["..."],
  "improvement_priorities": ["..."],
  "summary": "..."
}
```

每次建立 Brand DNA 都會新增一筆 `brand_dna_snapshots`，並將同品牌舊 snapshot 設為 inactive。這使系統可以保留歷史紀錄，同時只使用最新 active snapshot。

## 12. AI 任務設計

系統把 OpenAI 任務拆成多個明確的 task：

| 任務 | 用途 | 預設模型角色 |
| --- | --- | --- |
| `source_analysis` | 單一來源分析 | 萃取品牌人格訊號與證據 |
| `brand_dna` | 多來源綜合 | 建立可重複使用的品牌 DNA |
| `diagnosis` | 品牌診斷 | 產出經營洞察與優先行動 |
| `image_prompt` | 圖片企劃 | 將品牌 DNA 轉成圖片生成 prompt |
| `brand_image` | 圖片生成 | 產生品牌安全的行銷圖像 |
| `character_image` | 品牌角色圖 | 使用 GPT Image API 產生直式全身品牌代言角色圖 |
| `content_generation` | 文案生成 | 依 Brand DNA 生成顧客-facing 文案 |
| `marketing_suggestions` | 行銷需求建議 | 依品牌資料產生 3 個可直接帶入生成頁的行銷需求 |
| `risk_check` | 風險檢測 | 檢查合規、品牌語氣與安全改寫 |
| `simulation` | Persona 模擬 | 預估不同客群反應 |
| `ocr` | 圖片文字辨識 | 擷取圖片中的文字與視覺脈絡 |

### 12.1 Prompt 合約

系統在程式中定義了三層 prompt 合約：

- 基礎規則：
  - 只根據提供的資料、品牌 DNA、來源文字或使用者輸入回答。
  - 不捏造 URL、顧客評論、法律要求、數據、菜單品項或引用。
  - 若是推論，需要以推論方式表述。
- JSON 輸出規則：
  - 只輸出合法 JSON。
  - 不包含 Markdown fence、額外說明或 trailing text。
  - 欄位型別與 key 必須符合要求。
- 文字輸出規則：
  - 只回傳指定格式。
  - 保持簡潔、可被下游流程使用。

這些合約是系統穩定性的核心，因為 API 後續會直接解析模型輸出的 JSON。

### 12.2 AI 錯誤處理

系統對 OpenAI 呼叫做了幾個保護：

- 檢查 `OPENAI_API_KEY` 是否存在與是否為 placeholder。
- 將驗證錯誤轉成使用者可讀訊息。
- 遇到模型不支援 `temperature` 參數時，自動重試並移除該參數。
- 解析 JSON 失敗時，會嘗試取出文字中的 JSON 區塊再解析。
- AI 呼叫開始、失敗與成功解析都會寫入 `system_logs`。

## 13. 資料庫設計

資料庫使用 SQLite，預設檔案為 `runtime/data/app.sqlite3`。

### 13.1 `brands`

儲存品牌基本資料。

主要欄位：

- `id`
- `handle`
- `name`
- `category`
- `location`
- `description`
- `created_at`
- `updated_at`

### 13.2 `raw_sources`

儲存資料來源索引與原始檔案位置。

主要欄位：

- `id`
- `brand_id`
- `source_type`
- `input_kind`
- `title`
- `url`
- `original_filename`
- `raw_path`
- `mime_type`
- `status`
- `metadata_json`
- `created_at`
- `updated_at`

### 13.3 `extraction_results`

儲存每次整理來源的結果。

主要欄位：

- `id`
- `source_id`
- `brand_id`
- `status`
- `extracted_text`
- `artifact_path`
- `error`
- `metadata_json`
- `created_at`

### 13.4 `analysis_results`

儲存每次 AI 分析來源的結果。

主要欄位：

- `id`
- `source_id`
- `brand_id`
- `analysis_type`
- `status`
- `result_json`
- `error`
- `created_at`

目前 `analysis_type` 固定使用 `personality`。

### 13.5 `brand_dna_snapshots`

儲存 Brand DNA 版本。

主要欄位：

- `id`
- `brand_id`
- `result_json`
- `manual_overrides_json`
- `source_result_ids_json`
- `active`
- `created_at`

同一品牌每次只會有一個 active snapshot。

### 13.6 `jobs`

儲存系統處理工作。

主要欄位：

- `id`
- `brand_id`
- `job_type`
- `status`
- `input_json`
- `result_json`
- `error`
- `created_at`
- `started_at`
- `finished_at`

目前 job 是同步執行，但仍會留下狀態紀錄，方便 UI 與 debug。

### 13.7 `artifacts`

儲存生成或診斷成果。

主要欄位：

- `id`
- `brand_id`
- `job_id`
- `artifact_type`
- `title`
- `payload_json`
- `file_path`
- `created_at`

常見 `artifact_type`：

- `diagnosis_insight`
- `content_generation`
- `image_prompt`
- `brand_image`
- `brand_character_image_prompt`
- `brand_character_image`
- `risk_check`
- `simulation`

### 13.8 `subscription_state`

儲存目前 Demo 帳戶方案。

主要欄位：

- `id`
- `account_key`
- `plan`
- `updated_at`

目前固定單一帳戶 `demo`。

### 13.9 `usage_events`

儲存功能用量。

主要欄位：

- `id`
- `account_key`
- `brand_id`
- `feature`
- `plan`
- `units`
- `period_start`
- `metadata_json`
- `created_at`

用量週期以 UTC 當週起始日計算。

### 13.10 `system_logs`

儲存系統事件紀錄。

主要欄位：

- `id`
- `brand_id`
- `job_id`
- `source_id`
- `request_id`
- `level`
- `event_type`
- `stage`
- `message`
- `details_json`
- `duration_ms`
- `error`
- `created_at`

系統也會同步將 log 寫入 `runtime/logs/system.log.jsonl`。

## 14. API 說明

所有 API 成功時通常回傳：

```json
{
  "success": true,
  "...": "..."
}
```

錯誤時通常回傳：

```json
{
  "success": false,
  "error": "..."
}
```

### 14.1 頁面路由

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/` | 總覽頁 |
| `GET` | `/data-hub` | 資料中心 |
| `GET` | `/diagnosis` | 品牌診斷 |
| `GET` | `/generate` | 圖文生成 |
| `GET` | `/gatekeeper` | 規範守門員 |
| `GET` | `/simulation` | 市場模擬 |
| `GET` | `/artifacts/<filename>` | 讀取生成檔案 |

### 14.2 品牌與訂閱

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/brand` | 取得目前品牌 |
| `GET` | `/api/subscription` | 取得目前方案、功能權限與用量 |
| `POST` | `/api/subscription` | 切換方案 |
| `GET` | `/api/overview` | 取得總覽資訊 |

### 14.3 Demo 與工作區

| Method | Path | 說明 |
| --- | --- | --- |
| `POST` | `/api/demo/import` | 匯入 Demo 資料 |
| `POST` | `/api/case/import` | 同上，保留舊 API 名稱 |
| `POST` | `/api/reset` | 清空目前品牌工作區資料 |

### 14.4 全域掃描

| Method | Path | 說明 |
| --- | --- | --- |
| `POST` | `/api/global-scan/run` | 一次提交多種來源並建立 Brand DNA |
| `POST` | `/api/global-scan/social-preview` | 預覽 Instagram / Facebook 可擷取貼文 |
| `POST` | `/api/source-input/<source_type>/submit` | 單一來源快速送出並立即整理分析 |

`/api/global-scan/run` 要求至少 3 種來源。它支援 JSON 與 `multipart/form-data`：

- JSON 適合純 URL 或文字資料。
- Multipart 適合社群手動貼文與圖片上傳。

### 14.5 資料來源

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/sources` | 列出所有來源 |
| `POST` | `/api/sources` | 新增文字、URL、檔案或圖片來源 |
| `POST` | `/api/sources/<source_id>/extract` | 整理單一來源 |
| `POST` | `/api/sources/<source_id>/analyze` | 分析單一來源 |
| `POST` | `/api/sources/<source_id>/fallback` | 為失敗來源建立手動補資料來源 |

### 14.6 Pipeline 與工作

| Method | Path | 說明 |
| --- | --- | --- |
| `POST` | `/api/pipeline/run` | 對指定來源或全部來源重跑 Brand DNA pipeline |
| `GET` | `/api/jobs` | 列出最近 30 筆工作 |
| `GET` | `/api/jobs/<job_id>` | 取得工作詳情 |

### 14.7 Logs

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/logs` | 取得系統 logs |
| `GET` | `/api/jobs/<job_id>/logs` | 取得指定 job logs |
| `GET` | `/api/sources/<source_id>/logs` | 取得指定 source logs |

可用 query：

- `level`
- `event_type`
- `limit`

### 14.8 Brand DNA

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/brand-dna` | 取得目前 active Brand DNA |
| `POST` | `/api/brand-dna` | 直接建立 Brand DNA snapshot |
| `POST` | `/api/brand-dna/override` | 局部覆寫 Brand DNA |

### 14.9 診斷、生成、守門員、模擬

| Method | Path | 說明 |
| --- | --- | --- |
| `POST` | `/api/diagnosis/insights` | 產生品牌診斷洞察 |
| `GET` | `/api/generation-history` | 取得最近生成歷史 |
| `GET` | `/api/generation-detail/<identifier>` | 取得單一 artifact 詳情 |
| `GET` | `/api/latest-generated-post` | 取得最近一筆文案生成結果，並嘗試帶入相鄰生成圖 |
| `POST` | `/api/marketing-demand-suggestions` | 依品牌資料產生行銷需求建議 |
| `POST` | `/api/generate-personality-prompt` | 依 Brand DNA 產生圖片企劃 prompt |
| `POST` | `/api/generate-brand-image` | 使用 OpenAI image generation 產生圖片 |
| `POST` | `/api/brand-character-image-prompt` | 依 Brand DNA 產生品牌角色圖提示詞 |
| `POST` | `/api/generate-brand-character-image` | 使用 GPT Image API 產生品牌角色圖並寫回 Brand DNA |
| `POST` | `/api/generate-content` | 生成品牌文案 |
| `POST` | `/api/risk-check` | 檢查文案風險與合規，並產生安全改寫 |
| `POST` | `/api/simulate` | 執行 Persona 市場模擬 |

## 15. 訂閱方案與權限

目前 Demo 中有三種方案：

| 方案 | 價格 | 功能 | 配額 |
| --- | --- | --- | --- |
| `FREE` | `$0/month` | 部分診斷、文案生成、品牌圖像 | 每週 1 次文案、1 次圖片 |
| `AIR` | `$8/month` | 診斷、生成、圖像、守門員、模擬 | 每週 35 次文案、35 次圖片 |
| `PRO` | `$15/month` | 診斷、生成、圖像、守門員、模擬 | 文案與圖片無上限 |

功能權限由 `require_feature_access()` 檢查，用量由 `usage_events` 記錄。當方案不支援或超過 quota 時，API 會回傳 403 或 429。

## 16. 系統紀錄與可觀測性

系統有兩層紀錄：

1. SQLite `system_logs` 表。
2. `runtime/logs/system.log.jsonl` 檔案。

常見事件類型：

- `http.request`
- `source.created`
- `extract.started`
- `extract.completed`
- `extract.failed`
- `extract.exception`
- `analyze.started`
- `analyze.completed`
- `analyze.failed`
- `ai.requested`
- `ai.response_parsed`
- `ai.failed`
- `job.created`
- `job.status_changed`
- `brand_dna.started`
- `brand_dna.completed`
- `global_scan.started`
- `global_scan.source_created`
- `global_scan.source_started`
- `global_scan.source_completed`
- `global_scan.source_failed`
- `global_scan.completed`

每個 API request 會掛上 `request_id`，若前端或外部 client 傳入 `X-Request-ID`，系統會沿用；否則自動產生短 ID。

## 17. 錯誤狀態與常見失敗情境

### 17.1 OpenAI 未設定

症狀：

- OCR、來源分析、Brand DNA、生成、守門員或模擬失敗。

處理：

- 確認 `.env` 中有有效 `OPENAI_API_KEY`。
- 確認 `openai` 套件已安裝。

### 17.2 URL 擷取失敗

可能原因：

- 網站阻擋自動化瀏覽。
- 頁面需要登入。
- URL 格式不是 `http://` 或 `https://`。
- 公開頁面內容不足。
- 社群平台限制爬取。

處理：

- 使用資料中心的手動補資料。
- 改用手動貼文輸入。
- 貼上公開內容文字與圖片。

### 17.3 資料不足

全域掃描要求至少 3 種來源。若不足，`/api/global-scan/run` 會回傳 400。

### 17.4 來源整理成功但分析失敗

可能原因：

- AI 設定缺失。
- OpenAI API 暫時不可用。
- 模型輸出不是合法 JSON。

處理：

- 查看 `/api/logs` 或資料中心系統紀錄。
- 修正 `.env` 後重新分析來源。
- 重新建立 Brand DNA。

### 17.5 格式不支援

若上傳檔案副檔名不在支援清單，整理可能回傳 `needs_manual_text`。此時應改用手動文字補資料。

## 18. 啟動方式

### 18.1 建立環境

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

### 18.2 建立 `.env`

依第 9 節的環境變數範本建立或更新根目錄 `.env`，並填入有效的 `OPENAI_API_KEY`。

### 18.3 啟動

```powershell
python app.py
```

或：

```powershell
.\scripts\start.ps1
```

只執行已安裝好的環境：

```powershell
.\scripts\run.ps1
```

指定 port：

```powershell
.\scripts\run.ps1 -Port 5001
```

Windows batch：

```bat
scripts\run.bat
```

預設網址：

```text
http://127.0.0.1:5000
```

若 port 5000 已被占用，程式會嘗試切到下一個 port。

## 19. 測試

目前測試使用 `unittest`。

執行：

```powershell
python -m unittest discover -s tests
```

語法檢查：

```powershell
python -m py_compile app.py src\branddna\app.py
```

測試覆蓋的重點包含：

- 預設品牌初始化。
- 主要頁面可 render。
- OpenAI placeholder key 判斷。
- OpenAI 錯誤訊息安全化。
- 不支援 `temperature` 時自動重試。
- OpenAI usage/cost 回傳與 pricing 計算。
- 來源新增、整理、分析。
- Demo 匯入 idempotency。
- 重設工作區。
- 方案切換與 FREE 方案限制。
- AI workflow 是否建立 artifacts。
- 行銷需求建議。
- 品牌角色圖 prompt 與圖片生成。
- 最新生成貼文與相鄰圖片串接。
- 全域掃描 URL / 手動混合來源。
- 社群預覽。
- 網站候選連結排序。
- 手動補資料。
- 系統 logs 寫入與查詢。

## 20. Demo 資料

示範資料位於：

```text
examples/demo_sources/
├── website.json
├── facebook.json
├── google_reviews.json
└── recruitment.json
```

呼叫 `POST /api/case/import` 或 `POST /api/demo/import` 時，系統會把這些資料轉成 raw text source，寫入 `runtime/rawdata/demo_import`，並在 `raw_sources` 建立對應紀錄。

如果同一份 demo source 已匯入，系統會略過，避免重複建立。

## 21. 典型展示腳本

### 21.1 快速展示

1. 啟動系統。
2. 進入總覽頁。
3. 進入品牌診斷頁，按下匯入示範資料。
4. 到資料中心確認來源已建立。
5. 執行重新建立 Brand DNA。
6. 回到品牌診斷，產生診斷洞察。
7. 進入圖文生成，輸入行銷需求並生成文案。
8. 將文案送到規範守門員，檢查風險。
9. 將文案送到市場模擬，查看不同 Persona 反應。

### 21.2 真實品牌展示

1. 清空工作區。
2. 在資料中心輸入至少 3 種來源：
   - 官網。
   - Instagram 或 Facebook。
   - Google 商家或招募頁。
3. 勾選相關法規。
4. 輸入內部規範。
5. 送出全部可用來源。
6. 若某些公開頁失敗，使用手動補資料。
7. 建立 Brand DNA。
8. 進入後續診斷、生成、守門員與模擬流程。

## 22. 安全與資料注意事項

目前版本是本機 Demo：

- 所有 runtime 資料存於本機。
- `.env` 不應提交到版本控制。
- `runtime/` 是執行期資料，不應當作原始碼管理。
- OpenAI API key 不會被寫入 UI，錯誤訊息會嘗試遮蔽 secret。
- 上傳資料會被存入本機 `runtime/rawdata`。
- 若要處理真實客戶資料，應先建立資料保留、刪除與存取權限策略。
- 若未來改為多人或雲端版，需要加入使用者認證、租戶隔離、權限管理與資料加密策略。

## 23. 目前限制

目前專案設計重點是 Demo 與流程驗證，限制如下：

- 單一 Flask process。
- 單一 Demo 帳戶。
- 單一預設品牌。
- 工作雖然有 job 表，但實際上同步執行，尚未導入背景佇列。
- SQLite 適合本機展示，不適合高併發正式環境。
- 社群與公開網站可能阻擋 Playwright 擷取。
- AI 任務依賴 OpenAI API 與模型輸出穩定性。
- Brand DNA 目前由最新成功分析彙整，尚未提供完整版本比較 UI。
- 訂閱方案是 Demo 狀態，尚未串接正式金流。
- 目前沒有登入、角色權限與多租戶隔離。

## 24. 可延伸方向

### 24.1 產品化

- 加入正式帳號系統。
- 支援多品牌工作區。
- 支援團隊與角色權限。
- 加入正式訂閱與金流。
- 加入雲端檔案儲存。
- 加入操作審計與管理後台。

### 24.2 資料與 AI

- 加入來源可信度權重。
- 加入品牌 DNA 版本比較。
- 加入自動排程重掃來源。
- 加入更完整的競品資料輸入。
- 加入真實問卷或互動數據回寫。
- 加入 RAG 資料庫，讓店家規範、菜單與歷史 campaign 可被長期檢索。

### 24.3 內容工作流

- 支援多平台文案格式。
- 支援社群排程。
- 支援 A/B 版本管理。
- 支援圖片素材庫與品牌視覺規範。
- 支援審核流程與留言批註。

### 24.4 技術架構

- 將同步 job 改為背景 worker。
- 將 SQLite 換成 PostgreSQL。
- 將 runtime 檔案移至 object storage。
- 導入正式 observability。
- 導入更嚴格的 JSON schema 驗證。
- 加入 API auth 與 rate limiting。

## 25. 開發者速查

### 25.1 核心檔案

- `app.py`：啟動入口。
- `src/branddna/app.py`：所有 Flask route、資料庫、AI 任務、來源擷取與 pipeline。
- `src/branddna/templates/base.html`：共用 layout、sidebar、訂閱狀態、全域 JS helper。
- `src/branddna/templates/overview.html`：總覽頁。
- `src/branddna/templates/data_hub.html`：資料中心。
- `src/branddna/templates/diagnosis.html`：品牌診斷。
- `src/branddna/templates/generate.html`：圖文生成。
- `src/branddna/templates/gatekeeper.html`：規範守門員。
- `src/branddna/templates/simulation.html`：市場模擬。
- `tests/test_app.py`：主要測試。

### 25.2 核心函式

- `init_db()`：建立資料表與索引。
- `default_brand_id()`：確保預設品牌存在。
- `insert_raw_source()`：新增 raw source。
- `extract_source_content()`：整理單一來源。
- `analyze_source_content()`：AI 分析單一來源。
- `build_brand_dna()`：彙整來源分析並建立 Brand DNA。
- `run_pipeline_job()`：對來源執行整理、分析與 Brand DNA 建立。
- `run_global_scan_job()`：多來源全域掃描。
- `active_brand_dna()`：取得目前 active Brand DNA。
- `save_brand_dna_snapshot()`：儲存 Brand DNA snapshot。
- `create_artifact()`：儲存生成成果。
- `record_usage_event()`：記錄功能用量。
- `log_event()`：寫入系統紀錄。

### 25.3 新增 AI 任務時的建議步驟

1. 在模型設定中新增 task key。
2. 在 prompt contract 中新增任務規則。
3. 寫清楚輸入資料來源與 grounding rules。
4. 要求模型輸出穩定 JSON schema。
5. 加入 normalize function，避免 UI 直接依賴不穩定模型輸出。
6. 建立 artifact，方便歷史查詢。
7. 記錄 usage event。
8. 增加測試，mock `generate_openai_json()`。

### 25.4 新增資料來源類型時的建議步驟

1. 加入來源類型 label。
2. 若屬於全域掃描來源，加入 `GLOBAL_SCAN_URL_SOURCE_TYPES`。
3. 若需要特殊 URL 擷取策略，調整 `URL_SOURCE_CONFIG`。
4. 若需要前端輸入卡片，更新 `data_hub.html`。
5. 若需要手動格式驗證，更新表單收集函式。
6. 確認來源可被 `extract_source_content()` 正確處理。
7. 確認來源分析 prompt 能描述該來源的特性。
8. 加入測試。

## 26. 總結

BrandDNA Analytics Platform 的核心不是單純產生文案，而是建立一個可循環使用的品牌資料基礎。系統先把分散的公開資訊、社群內容、顧客回饋與內部規範轉成結構化品牌 DNA，再讓後續的生成、診斷、合規檢查與市場模擬都能依據同一套品牌脈絡運作。

在目前 Demo 版本中，系統已具備完整的端到端流程：

- 資料輸入。
- 來源整理。
- AI 來源分析。
- Brand DNA 建立。
- 品牌診斷。
- 文案與圖片生成。
- 合規守門。
- Persona 市場模擬。
- artifacts、jobs、logs 與 usage 記錄。

這使它適合作為創新創業競賽中的產品原型，也能作為未來正式 SaaS 化、顧問工具化或品牌營運平台化的基礎。
