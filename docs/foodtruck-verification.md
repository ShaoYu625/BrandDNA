# 餐車版交付驗證

驗證日期：2026-11-06（Asia/Taipei）。

正式站：https://branddna-foodtruck.pages.dev  
顧客頁：https://branddna-foodtruck.pages.dev/order  
獨立 API：https://branddna-foodtruck-api.kevinchung0625.workers.dev

## 結果

- `npm test`：17 項 node/domain/Worker runtime/client 測試通過。
- `npm run typecheck`：通過。
- `DEMO_URL=https://branddna-foodtruck.pages.dev npm run test:e2e`：4 項正式站瀏覽器測試通過。
- 瀏覽器驗證涵蓋品牌診斷 → FB 文案 → 字卡 → 確認 → 修改後重新確認 → 排程 → 日曆顯示。
- 手機 390px 完成模擬 LINE 會員 → 選餐 → 送單，另一個商家視窗依序接單／製作／可取餐；確認顧客頁標題實際更新為「可以取餐囉！」。
- 文字檔補件、來源分析、自拍照上傳、即時預覽、立即模擬發布、成效回饋、擺攤新增、菜單新增均在正式站完成。
- 1440px／390px 的九個商家頁面無頁面 JS 錯誤、無整頁橫向溢出；截圖已人工檢視。
- D1 正式站 5 MB JPEG 上傳／下載完整位元組回傳通過，128 KB 分塊，無需啟用 R2。
- 新版 API／頁面／官方參考照片與舊版 API 代理 HTTP 200。
- 獨立審查已確認重新審核、上傳非同步隔離、台北時間、菜單計價與新舊資料隔離。

驗收後已重置本餐車 Demo，保留原始品牌示範內容、三筆種子訂單與可用菜單。舊版 Worker、資料及設定保留。

## 範圍

此為課程 Demo：新版診斷、文案為可重複操作的示範生成；完整舊版 AI 工具可由進階入口使用。LINE／Meta／付款尚未正式串接，會員欄位與集點待研究。實際品牌公開故事與照片有來源，歷史餐點、測試價格與示範出車資料清楚區分。
