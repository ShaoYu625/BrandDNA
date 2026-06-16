# BrandDNA Analytics Platform

BrandDNA 是一個 Flask demo，用來把品牌資料匯入、抽取、分析成 Brand DNA，並延伸到內容生成、規範檢查與市場模擬。

## 專案結構

```text
.
├─ app.py                     # 相容入口：python app.py
├─ requirements.txt           # Python dependencies
├─ docs/                      # 文件：README.md、system_overview.md
├─ examples/demo_sources/     # /api/case/import 使用的 demo 原始資料
├─ scripts/                   # 啟動腳本
├─ src/branddna/              # Flask app、templates
└─ tests/                     # unittest 測試
```

執行時產生的 DB、raw data、artifact、upload 會集中在 `runtime/`，不放在根目錄，也不納入版本控管。

## 安裝

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

建立 `.env` 時可依下列範本建立；目前工作目錄沒有獨立的 `.env.example` 檔：

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_REASONING_MODEL=gpt-5.4
OPENAI_BALANCED_MODEL=gpt-5.4-mini
OPENAI_FAST_MODEL=gpt-5.4-nano
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
OPENAI_REASONING_DEFAULT=none
OPENAI_REASONING_BRAND_DNA=low
OPENAI_REASONING_RISK_CHECK=low
OPENAI_VERBOSITY_DEFAULT=low
OPENAI_IMAGE_DETAIL_OCR=high
PORT=5000
RUNTIME_FOLDER=runtime
DEMO_DATA_FOLDER=examples/demo_sources
```

## 執行

```powershell
python app.py
```

或使用腳本：

```powershell
.\scripts\start.ps1
.\scripts\run.ps1
```

預設網址：

```text
http://127.0.0.1:5000
```

## 功能路徑

- `/`：總覽
- `/data-hub`：資料匯入、抽取、分析 pipeline
- `/diagnosis`：Brand DNA 診斷
- `/generate`：內容與品牌圖像生成
- `/gatekeeper`：內容規範檢查
- `/simulation`：persona 市場模擬

## Runtime 資料

預設 runtime 配置：

```env
RUNTIME_FOLDER=runtime
DATA_FOLDER=runtime/data
RAWDATA_FOLDER=runtime/rawdata
ARTIFACT_FOLDER=runtime/artifacts
UPLOAD_FOLDER=runtime/uploads
LOG_FOLDER=runtime/logs
APP_DB_PATH=runtime/data/app.sqlite3
```

`examples/demo_sources/` 是專案 sample fixture；`runtime/` 是本機狀態，可刪除後由 app 重新建立。

## API

- `GET /artifacts/<filename>`
- `GET /api/brand`
- `GET|POST /api/subscription`
- `GET /api/overview`
- `POST /api/case/import`
- `POST /api/demo/import`
- `POST /api/reset`
- `POST /api/global-scan/run`
- `POST /api/global-scan/social-preview`
- `POST /api/source-input/<source_type>/submit`
- `GET|POST /api/sources`
- `POST /api/sources/<source_id>/extract`
- `POST /api/sources/<source_id>/analyze`
- `POST /api/sources/<source_id>/fallback`
- `POST /api/pipeline/run`
- `GET /api/jobs`
- `GET /api/jobs/<job_id>`
- `GET /api/logs`
- `GET /api/jobs/<job_id>/logs`
- `GET /api/sources/<source_id>/logs`
- `GET|POST /api/brand-dna`
- `POST /api/brand-dna/override`
- `POST /api/diagnosis/insights`
- `GET /api/generation-history`
- `GET /api/generation-detail/<identifier>`
- `GET /api/latest-generated-post`
- `POST /api/generate-content`
- `POST /api/marketing-demand-suggestions`
- `POST /api/generate-personality-prompt`
- `POST /api/generate-brand-image`
- `POST /api/brand-character-image-prompt`
- `POST /api/generate-brand-character-image`
- `POST /api/risk-check`
- `POST /api/simulate`

## 測試

```powershell
python -m py_compile app.py src\branddna\app.py
python -m unittest discover -s tests
```

測試會使用暫存 runtime，不會修改正式 `runtime/`。
