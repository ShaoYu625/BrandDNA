---
name: brand-libraries
description: Use when adding, editing, reviewing or removing entries in the BrandDNA food-truck 溝通語氣庫 (tone library), 核心客群庫 (audience library) or 一般餐車基準 (average-truck baseline for 差異化優勢) — or when the team asks to revise tone/audience definitions, examples, or the baseline. Covers the file, the entry rules, the id stability constraint, and how to verify.
---

# 品牌診斷三個庫：語氣庫、客群庫、一般餐車基準

品牌診斷（Brand DNA）的「溝通語氣」與「核心客群」只能從固定的庫裡挑，「差異化優勢」是本店跟「一般餐車基準」比較後優於一般的項目。三個庫都在同一個檔案：

`pages/static/truck/brand-libraries.mjs`

- `TONES`：溝通語氣庫（目前 20 個）。AI 挑 3–5 個；滑鼠移到語氣標籤會顯示 definition 與 example。產生貼文時也會把 definition／example 交給 AI 照著寫。
- `AUDIENCES`：核心客群庫（目前 15 個）。AI 挑 3 個，並另外寫一句這台餐車的情境；滑過標籤顯示 definition 與 example（典型情境）。
- `BASELINE`：一般餐車基準（10 項）。`method: 'data'` 由系統用實際資料判斷（程式在 `api/src/routes/truck.ts` 的 `dataComparison`），`method: 'ai'` 由 AI 讀資料中心判斷（沒有 AI 時 `ruleJudgements` 用關鍵字粗估）。

同一個檔案同時被前端（`merchant-dna.mjs` 的提示框）和 Worker（`truck-ai.ts` 的提示詞與 JSON schema enum、`truck.ts` 的驗證）import，所以改一次兩邊同時生效。型別在旁邊的 `brand-libraries.d.mts`，欄位有變才需要改。

## 規則

### 不能改的
- **`id` 上線後不要改、不要刪後重建**：schema 用 id 限制 AI 的輸出。
- **`label` 改了，舊的 Brand DNA 會對不到說明**：已建立的診斷存的是 label，對不到就變成沒有提示框的普通標籤（直到店家按「重新建立 Brand DNA」）。真的要改名時，在回報裡提醒團隊。
- 不要把同一個 `label` 用在兩個項目上（前端用 label 找說明）。
- `BASELINE` 裡 `method: 'data'` 的 5 項（ordering、membership、social、schedule、language）由程式計算；改它們的 `typical` 文字沒問題，但新增 `data` 項目要同時在 `dataComparison` 寫判斷邏輯，否則會一直顯示「資料不足」。新增 `ai` 項目不用改程式。

### 寫法（語氣庫）
- `label`：2–6 字，一看就懂的語氣名稱，跟其他項目要明顯不同（不要同時有「溫暖」和「溫馨」）。
- `definition`：一句話（約 15–35 字），寫「怎麼寫」而不是「是什麼」，要能直接當寫作指示，例如「先講重點：時間、地點、價格」。
- `example`：一句**行動餐車情境**的示範貼文句子，要真的用到這個語氣；不要出現真實店名、真實人名、價格以外的數字承諾。
- 不可以有療效、功效或保證性的說法（例如「吃了更健康」）。

### 寫法（客群庫）
- `label`：2–6 字的族群名稱。
- `definition`：這群人是誰＋在什麼時間／地點／需求下會買（約 20–35 字）。
- `example`：一個具體的購買情境（時間、動作），一句話。
- 避免用年齡、性別、收入當唯一定義，也避免帶貶義的稱呼。

### 寫法（一般餐車基準）
- `typical`：一般行動餐車在這一項「常見的做法」，一句話。這是**團隊整理的經驗值，不是統計調查**；畫面上已標示「參考基準」，不要寫出看起來像調查結果的精確百分比。
- 寫成「本店做得比這個好就算優勢」的形式，讓比較有方向。

## 修改步驟
1. 編輯 `pages/static/truck/brand-libraries.mjs`（保持 UTF-8、繁體中文、台灣用語）。
2. 檢查：id 唯一、label 唯一、每個欄位都有值。
3. 執行：
   ```powershell
   npm test            # 診斷只會用到庫裡的項目、比較表依基準順序
   npm run typecheck
   npm run render:pages
   ```
4. 在本機開「品牌診斷」按「重新建立 Brand DNA」，滑過語氣／客群標籤確認說明顯示正確，並看「與一般餐車比較」表。
5. 部署：`npm run deploy:foodtruck:api` 與 `npm run deploy:foodtruck:pages`（兩邊都要，因為前後端都 import 這個檔案）。
