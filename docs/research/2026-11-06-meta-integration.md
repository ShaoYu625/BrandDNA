# BrandDNA 餐車系統：Meta 串接研究

研究日期：2026-11-06（Asia/Taipei）。依目前餐車版程式與當日 Meta 官方文件整理。

這份文件是串接研究與實作建議，尚未登入提供的帳號、檢查其資產、申請 Meta App、取得權杖、發布貼文或變更線上服務。未保存使用者提供的帳密。以下清楚區分已查證的文件事實、現有程式狀態與建議。

## 1. 依現有功能決定串接範圍

建議採用 Meta 官方 API 直連，沿用 Cloudflare Pages、Worker、D1 與 `TruckWorkspace`，不先引入付費社群排程服務。

| 系統現有功能 | 真實串接需要的能力 | 第一版建議 |
| --- | --- | --- |
| 工作區設定：Instagram 與 Facebook | 登入授權、選擇帳號／粉專、顯示有效權限、重新連線與解除連線 | 必做 |
| 資料中心：社群資料來源 | 匯入自己管理的既有貼文、圖片連結、發布時間與原始網址 | 必做 |
| 品牌診斷／Brand DNA | 把匯入貼文轉為既有來源資料，再執行現有分析 | 沿用分析流程；Meta 不提供品牌人格診斷 |
| 貼文工作區：確認後立即發布 | IG 單張照片＋文案、FB 粉專照片／文字／連結貼文 | 必做 |
| 行事曆：排程發布 | 後端到時執行、發文結果追蹤、取消與錯誤恢復 | 必做 |
| 貼文成效 | 讀取真正的貼文指標，保留來源、時間與缺值原因 | 必做 |
| 成效回饋資料中心 | 用真實成效產生可追溯的來源摘要 | 必做 |
| 手機點餐、訂單、會員 | 不依賴 Meta；可另記錄貼文導流來源 | 既有點餐功能照常運作 |

目前沒有廣告活動、預算、私訊收件匣或留言管理介面。因此產品第一版不做 Marketing API 廣告投放、Messenger／IG 私訊客服、商品目錄或 Threads。這是依系統功能推導的範圍；登入配置本身可能仍有必要的依賴權限，見下文。

## 2. 2026 年的新登入流程，不能照舊教學直接做

### 已查證的官方變更

Meta 現在建議新 IG 整合採 **Instagram API with Unified Login**。使用者可選 Instagram 或 Facebook 登入，IG 不必綁 Facebook 粉專，但 App 與 IG 資產需要對應的商務資產組合（business portfolio）。API 主機是 `graph.facebook.com`，使用 Business Integration System User Access Token。來源：[Unified Login 概觀](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login)。

官方遷移文件明確說明：**新建立的 App 不能再設定舊的 Instagram API with Instagram Login**；既有整合目前沒有公布終止日期。不能把舊的 `instagram_business_*`、`graph.instagram.com` 教學當成新 App 的預設實作。來源：[Instagram Login 遷移指南](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide)。

| 方案 | 條件與代價 | 對本系統的建議 |
| --- | --- | --- |
| IG Unified Login＋FB Pages API | 新 IG 推薦方案；IG 不需粉專，但需要商務資產組合，且須處理其登入配置要求 | 優先路線；IG 與 FB 連線紀錄分開管理 |
| Facebook Login for Business＋綁粉專的 IG | IG 必須是專業帳號且連結 FB 粉專；使用 Page／User token 與相應權限 | 若本來已同時管理 FB／IG，可作備選；需確認新 App 後台能配置所需用例 |
| 舊 Instagram Login | 使用 IG 專屬權限與主機；新 App 無法新增此設定 | 只在帳號已有此類 App 時考慮維護，不當成新建方案 |

第二條路的帳號條件可查 [Instagram API with Facebook Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login)。目前沒有實際帳號資產資料，不能認定已符合任一路線。

### Unified Login 的重要權限取捨

官方入門文件把預設配置中的 `instagram_basic` 與 `instagram_manage_messages` 列為必要，另預選內容發布、留言與廣告權限，並允許編輯權限、加上 insights。**即使我們不做私訊客服，也不能承諾新流程只需三項發文／成效權限。** 要在實際 App 後台檢查最終配置與依賴，授權畫面與審查說明必須符合實際取得的權限；不因預設勾選而開發廣告或收集私訊內容。來源：[Unified Login 入門，2026-10-27 更新](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started)。

## 3. 需要的 API 與權限

以下 API 路徑省略主機與版本，實作時由後端統一加上。已讀到的官方 reference 標示最新版本為 `v27.0`；建議以 `META_GRAPH_VERSION` 明確固定經測試的版本，不使用無版本網址，也不把舊範例的 v21／v22 當成目前版本。

### Instagram：以 Unified Login 為基準

| 用途 | API／能力 | 主要權限或條件 |
| --- | --- | --- |
| OAuth code 換權杖 | `/oauth/access_token`，由伺服器呼叫 | Meta App ID／Secret、已註冊 redirect URI、配置 ID |
| 識別所連商家 | `GET /me?fields=client_business_id` | 儲存商務資產組合識別 |
| 找到分享給 App 的 IG | `GET /me/assigned_instagram_accounts?fields=id,username` | `instagram_basic` |
| 匯入既有貼文 | `GET /{ig-account-id}/media`，分頁取得 caption、media type、permalink、timestamp 等 | `instagram_basic`；可用欄位按媒體型態確認 |
| 建立發文容器 | `POST /{ig-account-id}/media` | `instagram_basic`、`instagram_content_publish` |
| 檢查處理狀態 | `GET /{container-id}?fields=status_code,status` | 對應帳號與容器的存取權 |
| 完成發布 | `POST /{ig-account-id}/media_publish` | 保存回傳的正式 media ID |
| 檢查發文額度 | `GET /{ig-account-id}/content_publishing_limit` | 以實際結果判斷可否發布 |
| 貼文／帳號成效 | `GET /{media-id}/insights`、`GET /{ig-account-id}/insights` | `instagram_basic`、`instagram_manage_insights` |

Unified Login 的 `/me` 是商務整合系統使用者，**不是 IG 帳號**，不能直接拿它當發文目標。帳號辨識與權杖種類見 [Authentication and access tokens](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication)。權限家族為 `instagram_*`，見 [Unified Login permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions)。

發文流程見 [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)；既有媒體與上傳參數見 [IG User Media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)。

### Facebook：粉專 API

| 用途 | API／能力 | 主要權限或條件 |
| --- | --- | --- |
| 列出可管理粉專 | 一般 User token 路線：`GET /me/accounts` | `pages_show_list`；取得 Page ID、Page token 與 tasks |
| 匯入粉專內容 | Page 的 posts／feed 讀取端點，僅納入粉專自己發布的內容 | `pages_read_engagement`；若端點涉及訪客貼文等內容，另核對 `pages_read_user_content` |
| 發布文字／連結 | `POST /{page-id}/feed` | Page token、`pages_manage_posts`，及其依賴 `pages_read_engagement`、`pages_show_list` |
| 發布照片 | `POST /{page-id}/photos` | 同上，並需對粉專有 `CREATE_CONTENT` task |
| 讀取成效 | `GET /{page-id}/insights`、對應貼文 insights | `read_insights`、`pages_read_engagement` 與 `ANALYZE` task |
| 粉專原生排程（備選） | `published=false`＋`scheduled_publish_time` | 官方貼文指南目前列出 10 分鐘至 30 天範圍 |

Page token 的取得方式必須依登入配置與 token type 區分；不要把 Unified Login 的系統使用者 token 當成一般 User token，直接假設 `/me/accounts` 行為相同。來源：[Pages API overview](https://developers.facebook.com/documentation/pages-api/overview)。

照片端點與基本發文權限已由 [Page Photos reference](https://developers.facebook.com/docs/graph-api/reference/page/photos/) 核對；文字發文與讀取條件見 [Page Feed reference](https://developers.facebook.com/docs/graph-api/reference/page/feed/)。成效權限見 [Get Page Insights](https://developers.facebook.com/documentation/pages-api/platforminsights/page)。

### 不直接照抄文件中的所有權限

官方文件也存在不同步之處：Pages 貼文教學列有 `pages_read_user_engagement`，但當日權限總表沒有這個項目；照片 reference 則清楚列出基本發文三項權限。以各 endpoint reference、[權限總表](https://developers.facebook.com/documentation/development/permissions)、實際 App Dashboard 與成功的測試呼叫交叉確認，不申請看起來相似但不存在的名稱。

若採綁粉專 IG 路線，還要納入 IG 權限對 Page 權限的依賴；由 Business Manager 指派角色的情況，部分端點另列 `ads_read`／`ads_management` 要求，不能一概宣稱完全不會需要廣告相關權限。這些依賴不等於我們要做廣告功能。

## 4. 現有系統必須先處理的落差

### 圖片、字卡與文案

現有 `pages/static/truck/client.mjs` 優先把大圖壓成 WebP，預設品牌圖片也是 WebP；`merchant-modals.mjs` 的字卡只是 HTML 疊層。IG 發布圖片必須是 JPEG，且 Meta 需要能從公開 URL 取得圖檔。來源：[Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)。

建議新增「發布版本圖片」：將照片與字卡合成固定版本的 JPEG，先在預覽顯示，商家確認該版本後才可發布。建議輸出 1080×1350 或 1080×1080，保留原圖供編輯，沿用既有 D1 圖片儲存即可，不強制新增 R2。

IG reference 目前列出：圖片最大 8 MB、長寬比 4:5 至 1.91:1、文案最多 2200 字元。系統目前文案上限是 10000，故需新增平台別發布驗證；JPEG 另沿用系統 5 MB 上限，選較嚴格者。來源：[IG User Media 圖片規格與 caption 參數](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)。

圖片 URL 要轉為可信設定的完整 HTTPS 網址；`/static/...` 應指向 Pages，不能直接接到 Worker origin。發布圖在排程與容器處理期間必須可讀，不依賴瀏覽器登入 cookie，並納入現有圖片清理程式的引用保護。

### 真正的排程與避免重複發文

現有 `post.schedule` 只存時間；`TruckWorkspace` 沒有 `alarm()`，Worker 的 cron 目前僅每日清理照片。

建議 IG／FB 都先使用同一份後端工作佇列，由現有 Durable Object 的 alarm 處理到期工作，再安排下一個時間。瀏覽器關閉仍應運作，不用 `setTimeout` 或依賴有人開著頁面。Cloudflare 每個物件一次只有一個 alarm，且可能重試，所以需以資料表管理多筆工作並處理重入。來源：[Cloudflare Durable Objects alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)。

IG 容器會在 24 小時後過期，長期排程應儲存已確認的內容版本，到時間接近時才建容器，不能在商家排一個月後的貼文時就建立。來源：[IG User Media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)。

發布工作需記錄：目標帳號、內容版本、容器 ID、遠端貼文 ID、開始時間、重試次數與結果。現有 `Idempotency-Key` 只防本地操作重送；Meta 已成功但回應遺失時，不能直接再發一遍。結果不明應進入待查證狀態，優先查容器／遠端狀態，必要時讓商家確認。

官方發文總覽列出 100 篇／24 小時，但 `media_publish` reference 與同頁輪播段落仍列 50。**不把任何一個數字寫成保證額度**，發布前查 `content_publishing_limit`，遇限流依平台回應退避。來源：[Media Publish reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish)。

### 成效欄位不能原樣套用

現有 `Metrics` 強制所有數字都有值，`secondary.mjs` 又把缺值轉為 0。正式資料應支援 `null`、指標來源、讀取時間、統計期間與不可取得原因。

| 現有欄位 | IG 建議映射 | FB 建議映射／注意事項 |
| --- | --- | --- |
| reach | media insights 的 `reach` | 檢查 `post_total_media_view_unique`；保留原始定義，不能假設跨平台完全相同 |
| likes | `likes` | 選定「按讚」或全部 reactions，介面名稱必須一致 |
| comments | `comments` | 對應貼文 comment count；若讀取留言內容，另處理權限與個資 |
| saves | `saved` | 不預設有與 IG 對等的收藏指標，無支援則顯示「不適用」 |
| clicks | 不把 profile visits 或 profile activity 硬當成貼文 CTA 點擊 | 查實際支援的連結點擊指標與 breakdown，不能用所有點擊代替 |
| 新增 views／shares | 媒體型態支援時讀取 | `post_media_view`／shares，保留平台定義 |

IG insights 可延遲最多 48 小時；空結果不是 0。部分個人檔案活動可拆出連結行為，但不等於每篇外部連結點擊。來源：[Instagram Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)。帳號與媒體層級要分開保存，見 [Instagram Insights guide](https://developers.facebook.com/documentation/instagram-platform/insights)。

FB 舊 `post_impressions`、`post_impressions_unique` 等已列入棄用清單，分別有 views／unique media viewers 類替代；不要照仍含舊欄位的教學範例建立整合。來源：[Deprecated Page Insights metrics](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics)、[Insights reference](https://developers.facebook.com/docs/graph-api/reference/insights/)。

跨篇 reach 加總應標成「各篇觸及加總，未跨篇去重」，不能稱為唯一觸及人數。模擬與真實成效應分開顯示，回饋 Brand DNA 時附來源帳號、貼文 ID、時間範圍及樣本數，避免把模擬資料混進正式分析。

若要知道貼文帶來多少點餐，建議另做帶貼文識別的導流網址／UTM，將來源保留到訂單；這是本站歸因資料，不能冒充 Meta 原生 clicks，也不能把一般 IG caption 中的 URL 當成可點擊連結。這項可在第一版核心串接後做。

### 商家授權與儲存

現有 Worker 程式沒有檢查商家登入：`/api/truck/actions` 可提交商家操作，WebSocket 的 merchant view 也不是以登入權限決定。這對模擬版與真正發文的影響不同：**開啟真實發文前，必須由後端保護連線設定、商家操作與 merchant WebSocket**，也要保護直接呼叫 Worker 的入口，不能只擋 Pages 畫面。

目前整份 merchant state 會回傳前端並透過 WebSocket 廣播，因此 access token、App secret 與 OAuth state 不能加進 `TruckState`。秘密與連線憑證另存後端；前端只收到帳號名稱、可用功能、連線狀態及重新授權提示。

OAuth 使用一次性 state 綁定已登入商家、固定允許的 callback，後端交換 code，token 不放 URL、日誌或分析事件。Unified token 有效期間依 configuration 決定，不假設一律 60 天或永久；保存 client business ID、config ID、資產 ID，失效或撤銷後停止發布並顯示重新連線。來源：[Authentication and access tokens](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication)。

Demo 重設不應刪除真實連線或正式發布紀錄；已發到 Meta 的內容也不會因本地 reset 消失。正式已發布貼文被編輯時，需保留原遠端紀錄並另建草稿版本，不能套用現在把同一筆變回 draft 的行為。上述為本專案實作建議。

## 5. 建議的專案接法

### 路由與資料分工

新增路由使用 `/api/truck/meta/*`。原因是現有 Pages proxy 只把 `/api/truck/` 送到餐車 Worker，其他 API 路徑可能送去舊版 Worker；若直接新增 `/api/meta/*`，會走錯服務。

建議的內部介面（尚未實作）：

| 路由 | 用途 |
| --- | --- |
| `GET /api/truck/meta/status` | 商家可見的連線／功能狀態，不回傳 token |
| `GET /api/truck/meta/connect` | 已登入商家開始指定平台的 OAuth |
| `GET /api/truck/meta/callback` | 驗證一次性 state、交換 code、保存資產與連線 |
| `POST /api/truck/meta/disconnect` | 停止該連線工作並解除授權；處理平台撤權結果 |
| `POST /api/truck/meta/import` | 分頁匯入自己管理的貼文，依遠端 ID 去重 |
| `POST /api/truck/meta/insights/sync` | 有上限的後端成效同步工作 |
| `GET／POST /api/truck/meta/webhook` | 平台驗證與事件入口，獨立於商家 cookie 驗證 |

Webhook GET 驗證 verify token 後回傳 challenge；POST 以原始 body 與 App secret 驗證 `X-Hub-Signature-256`，去重後處理。不要把它視為所有成效都會即時推送的管道，第一版成效仍採排程拉取。各事件支援與權限需另核對，沒有產品用途就不訂閱私訊／留言正文。來源：[Set up Instagram Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)。

後端建議分成：Meta HTTP adapter、OAuth／資產連線、發布工作、媒體輸出、成效同步。`applyTruckAction` 保持純資料轉換，不在其中加入網路副作用。

私有連線紀錄保存 token type、資產 ID、config ID、授權與有效期資訊；發文紀錄保存 content version、target account、mode、remote ID／permalink、狀態與錯誤。工作狀態可區分 queued、publishing、published、failed、unknown，避免 API 沒確認成功就顯示已發布。

### 會動到的既有檔案

| 檔案 | 必要改動 |
| --- | --- |
| `api/src/routes/truck.ts` | 擴充 Post／Metrics；保留 demo 模式；正式發布狀態與不可變內容版本 |
| `api/src/truck-workspace.ts` | 到期工作 alarm、發文結果持久化、重試與 merchant 授權 |
| `api/src/truck-store.ts` | 新狀態持久化；避免把秘密放進廣播資料 |
| `api/src/index.ts` | Meta 路由、OAuth／Webhook 分流；既有清理流程保護待發圖片 |
| `api/src/schema.ts` | Meta App 設定與後端 secret bindings 型別 |
| `api/wrangler.foodtruck.toml` | 公開設定；秘密透過 secret 管理，不寫入設定檔 |
| `api/migrations/` | 若私有連線／成效歷史使用 D1，新增 migration |
| `pages/static/truck/client.mjs` | 發布圖片與連線 API；保持 token 留在後端 |
| `pages/static/truck/merchant-modals.mjs` | 預覽最終 JPEG、平台別文案驗證、選定實際目標帳號 |
| `pages/static/truck/merchant.mjs` | 真實發布／排程結果與失敗恢復 |
| `pages/static/truck/secondary.mjs` | 連線設定、指標缺值、資料來源與同步狀態 |
| `pages/static/truck/merchant-views.mjs` | 分開呈現 demo／真實內容與成效 |
| `pages/functions/api/[[path]].ts` | 核對 callback、cookie 與錯誤的代理行為；維持餐車路徑 |

## 6. 帳號與上線條件

帳號尚未登入，以下全部是待核實項目，不能因取得帳密就當成已具備：

- 該帳號登入的是 Facebook、Instagram 或已有開發者資格的帳號。
- 是否已存在 Meta App、其擁有者與 business portfolio。
- 是否有可管理的 FB 粉專，以及發文／成效所需 task。
- IG 是否為 Business／Creator；若選綁粉專路線，是否已連結正確 Page。
- Unified Login 的 config 相容性、實際授予權限、資產與有效期間。
- 正式服務所需的企業驗證、App Review 與目前可用權限。

先用具有 App 角色的真實專業測試帳號與測試粉專做 Standard Access 驗證；接外部商家須依各權限取得 Advanced Access 並符合上線要求。Unified Login 入門目前不支援以虛擬 Test Users 代替專業帳號。來源：[Eligibility and troubleshooting](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting)。

審查素材至少準備可用的登入／連線入口、隱私政策與資料刪除說明、逐權限用途、可測試的網站與操作錄影；確切企業驗證及申請項目以 App 後台要求為準。來源：[App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)、[Webhooks production requirements](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)。

## 7. 實作順序與驗收

1. **核實帳號與資產**：確認 App、商務資產組合、IG／FB 控制權與可用登入配置，固定測試帳號。
2. **完成商家驗證與 OAuth**：連線狀態可見，秘密不出現在前端／WebSocket／日誌；取消登入可恢復。
3. **先讀資料**：成功匯入一批真實貼文，保留原文、網址、時間與遠端 ID，重做不重複新增。
4. **完成最終圖片與單篇發布**：用已確認版本發布一篇明確標示的測試內容，保存遠端 ID，從平台網址驗證結果；本地成功提示不能代替驗證。
5. **完成排程**：關閉瀏覽器仍能執行；修改內容使舊確認失效；取消與斷線不會造成重複發布。
6. **完成真實成效**：取得支援指標，缺值與權限錯誤不變 0；顯示更新時間，分開 demo 與真實資料。
7. **接回 Brand DNA**：把帶有來源與統計期間的成效摘要加入資料中心，確認不污染示範資料。

必要故障情境：token 過期／撤銷、權限不足、帳號資產移轉、圖片無法抓取、容器過期、API 限流、發布結果不明與重複 alarm。針對這些真正影響發布的邊界測試；研究階段沒有執行 live 發文或授權測試。

## 8. 查證方式與限制

當日本機程式已逐檔閱讀；官方網站透過公開 HTTPS 讀取英文文件並確認標題與回傳內容。一般網頁讀取工具曾遇限流，後以普通 HTTP 請求成功讀取，未使用登入 cookie、帳號資料或任何桌面操控。Meta 官方 Postman 作為補充入口，較新的登入與權限結論以 2026 年官方文件為準。

`@Chrome` 的瀏覽器連線回報 `The browser access host is unavailable`，因此帳號內資產與 Dashboard 設定仍未核實。這不影響上述公開 API 研究，但不能據此宣稱已完成串接。

搭配文件：`2026-11-06-meta-sources.json` 保存實際取得的官方頁面 URL、標題、更新日期與研究用內容雜湊；不包含帳密、token 或整篇官方文件複製。
