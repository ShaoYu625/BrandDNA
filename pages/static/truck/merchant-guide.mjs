// 使用教學: a handbook for a merchant opening the system for the first time. Every chapter links to the page it teaches.
import { esc, icon } from './client.mjs';
import { store, orderPath } from './merchant-ui.mjs';

export const CHAPTERS = [
  { id: 'start', icon: 'truck', title: '開始之前：帳號與切換餐車', href: '/settings', go: '前往工作區設定',
    can: ['一台餐車就是一個帳號（店名＋帳號＋密碼）', '同一個瀏覽器可以同時登入多台餐車並快速切換', '修改店名、品牌介紹與英文店名'],
    steps: ['左上角的餐車名稱就是「切換餐車」：點開可以切到其他已登入的餐車，或登入／註冊新餐車。', '右上角頭像是帳號選單：變更密碼、登出這台餐車。', '到「工作區設定 → 品牌資料」填好店名、標語、介紹與英文名稱，點餐頁和 AI 寫文都會用到。'] },
  { id: 'dashboard', icon: 'grid', title: '商家總覽：每天打開先看這裡', href: '/dashboard', go: '前往商家總覽',
    can: ['一眼看到待確認草稿、新訂單、下一場出攤', '從右上角鈴鐺查看所有需要處理的通知'],
    steps: ['上方四個數字是今天最重要的狀態。', '「下一場出車」卡片提醒你出攤前發預告。', '鈴鐺會依「訂單、貼文、出攤、會員、系統」分類，只列出真的需要處理的事；點一下就會帶你去處理。'] },
  { id: 'menu', icon: 'leaf', title: '菜單管理：上架、售完與英文菜單', href: '/menu', go: '前往菜單管理',
    can: ['新增、編輯、刪除餐點與照片', '一鍵設定「今日售完」，隔天自動恢復', '下架暫時不賣的品項、調整排序', 'AI 一次翻譯英文菜單'],
    steps: ['按「新增餐點」，填名稱、價格、分類、介紹並上傳照片。', '賣完時把「今日售完」開關打開，顧客端會立刻顯示售完，隔天自動恢復。', '用 ↑ ↓ 調整顧客看到的順序；暫時不賣就按「下架」。', '按「AI 翻譯英文菜單」或在編輯視窗手動填英文；顧客切換 English 就會看到，訂單仍以中文送到你這裡。'] },
  { id: 'qr', icon: 'qr', title: '顧客點餐與 QR Code 素材', href: '/orders', go: '前往訂單管理',
    can: ['下載 QR Code 圖檔、向量檔、A5 海報與方形桌卡', '複製點餐連結放在 IG／FB 簡介'],
    steps: ['到「訂單管理」最下方展開「顧客點餐 QR Code 素材」。', '海報適合貼在餐車窗口，方形桌卡可以直接發 IG。', '顧客掃碼後可以加入會員、輸入折扣碼、切換中英文點餐；送單後會看到取餐號碼和「前面還有幾單」，餐好了手機會震動並發出提示音。'], extra: `<a class="text-link" href="${esc(orderPath())}" target="_blank" rel="noopener">${icon('external-link', 12)} 打開顧客點餐頁看看</a>` },
  { id: 'orders', icon: 'shopping-bag', title: '訂單管理：接單到完成', href: '/orders', go: '前往訂單管理',
    can: ['新訂單響提示音、跳出提醒，分頁標題顯示等待中的筆數', '新訂單／製作中／待取餐三欄，先來的排前面，顯示等候時間與待製作彙總', '按錯可以「退回」，顧客沒來或售完可以「取消」（折扣碼自動退回）', '收攤時「全部完成取餐」；忙不過來或休息時「暫停接單」'],
    steps: ['開著訂單頁時螢幕不會自動關閉；第一次點一下畫面後，新訂單就會響提示音（可以用「提示音」開關）。', '新訂單按「接單並開始製作」，做好按「通知可取餐」，顧客取餐後按「完成取餐」，顧客手機上的進度會同步更新。', '有使用折扣碼的訂單會顯示折扣碼與折抵金額，總計已經扣除。', '要暫停線上點餐，按上方的「暫停接單」並寫一句給顧客的說明；顧客點餐頁會顯示，無法送出新訂單。'] },
  { id: 'members', icon: 'users', title: '會員管理：會員分群、推播與訪客名單', href: '/members', go: '前往會員管理',
    can: ['「會員」與「訪客」分開：訪客只記姓名與電話，不做分析', '依上次消費時間、消費次數、累積金額與平均單價排序', '自動分出常來客、潛在客、流失客', '對每個分群推播活動（買一送一、滿額折）或專屬折扣碼', '建立公開折扣碼、查看兌換次數', '看會員輪廓（性別、年齡、居住地、職業、收入）'],
    steps: ['上方切換「會員／訪客」。分群、推播和會員輪廓只計算會員；訪客是沒加入會員直接點餐的顧客。', '點表格欄位標題可以排序，點會員可以看訂單與資料。', '在分群卡片按「推播優惠」，選擇活動或專屬折扣碼，按「AI 幫我寫」產生訊息後送出。會員會在點餐頁的「我的會員」收到訊息與折扣碼。', '顧客加入會員時填完資料會自動拿到折扣碼；還沒填的會員可以按「邀請填寫資料」再推播。', '分群條件（幾天算流失、幾次算常客）可以在工作區設定調整。', '顧客換手機時，同一支手機號碼需要登入碼才能登入會員：確認是本人後，打開這位會員按「產生登入碼」，請他在點餐頁輸入（10 分鐘內有效）。'] },
  { id: 'data', icon: 'database', title: '資料中心：品牌資料的來源', href: '/data-hub', go: '前往資料中心',
    can: ['在頁面上方直接新增：手動輸入、官網 HTML、圖片文字辨識（菜單、海報）、批次貼上、多個檔案', '官網用「另存網頁」的 .html 檔匯入，附三步驟教學', '編輯、刪除品牌資料；匯入 Meta 既有貼文、接收貼文成效回饋'],
    steps: ['在「新增品牌資料」選一種方式：手動輸入品牌故事、上傳官網 .html、辨識菜單照片，或一次貼上多篇貼文。', '官網：用電腦打開官網，按 Ctrl + S（Mac ⌘ + S）選「網頁，完整」存檔，再把 .html 檔拖進來；匯入前會先預覽讀到的文字。', '每筆資料都可以編輯或刪除；新增後按「分析」，再到品牌診斷重新建立。'] },
  { id: 'diagnosis', icon: 'dna', title: '品牌診斷：五大面向與品牌人格', href: '/diagnosis', go: '前往品牌診斷',
    can: ['整理品牌定位、溝通語氣、核心客群、差異化優勢、內容主軸', '語氣與客群來自固定的語氣庫、客群庫，滑過可看定義與範例', '差異化優勢＝跟「一般餐車」比較後優於一般的項目', '12 種品牌人格分數（顯示前五名）'],
    steps: ['資料中心有新資料時，按「重新建立 Brand DNA」。', '把滑鼠移到語氣或客群標籤上（手機點一下），會出現定義與範例。', '往下看「與一般餐車比較」：點餐、會員、發文、出攤、外語由系統依實際資料判斷，其他由 AI 讀資料中心判斷；「一般餐車」是團隊整理的參考基準。', '五大面向會套用到之後的每一則 AI 貼文。'] },
  { id: 'posts', icon: 'pen', title: '貼文工作區：快速開始、趨勢與自動提醒', href: '/generate', go: '前往貼文工作區',
    can: ['快速開始分四類：內容主軸、趨勢、季節性、餐車營運，每類都建議貼文主題', '趨勢是這幾天最熱、最好發揮的三個話題（整理自 Google 新聞與搜尋趨勢），每個附 3 個梗和時事優惠', '點主題就產生 IG／FB 草稿，可以改文案、換照片、加字卡', '三天沒發文或沒排程時，系統主動提醒並直接準備好草稿'],
    steps: ['在「快速開始」切換類別，點一個主題產生草稿；內容主軸的主題來自品牌診斷。', '在「趨勢」挑一個梗按「用這個梗寫貼文」，可以順便建立時事折扣碼（例如 NVDA20，預設 3 天），折扣碼會自動寫進文案；熱度過了到會員管理停用。發文前先點開來源新聞、看風險提醒；災難、選舉、軍事等高風險話題會列在「不建議搭」。', '草稿要按「確認內容」後才能發布或排程；修改過要重新確認。', '連結 Meta 後可以直接發布到 IG／FB；沒連結時可複製文案自行發布，再按「標記為已發布」。'] },
  { id: 'calendar', icon: 'calendar', title: '行事曆與發文：出攤行程與顏色標籤', href: '/calendar', go: '前往行事曆',
    can: ['新增、編輯、刪除出攤場次', '出攤（綠色）和社群貼文（橘色）排在同一個月曆', '自訂顏色標籤（例如「節慶活動＝紅色」），系統會記住'],
    steps: ['按右上角「新增出攤」填日期、時間與地點。', '排程貼文或新增出攤時，在「顏色標籤」選一個；按「自訂」輸入類型名稱、挑顏色，之後排程都能直接選，同一類貼文下次會自動帶入。', '月曆上方的圖例點一下自訂標籤，可以改名、換色或刪除。', '出攤前兩天還沒有預告貼文，鈴鐺會提醒你。'] },
  { id: 'analytics', icon: 'chart', title: '貼文成效：數字回饋品牌', href: '/analytics', go: '前往貼文成效',
    can: ['填寫或同步每篇貼文的觸及、按讚、留言、收藏、點擊', '把成效回饋到資料中心，讓下次診斷更準'],
    steps: ['已發布的貼文按「填寫成效」，輸入 IG／FB 後台的數字；連結 Meta 的貼文會自動同步。', '按「加入資料中心」後會直接跳到資料中心，看到新增的成效資料。'] },
  { id: 'settings', icon: 'settings', title: '工作區設定：串接與 AI', href: '/settings', go: '前往工作區設定',
    can: ['連結 Instagram／Facebook', '查看 AI 助理狀態與本月用量', '設定會員資料完成禮金額與分群條件'],
    steps: ['Meta 連線後可以匯入既有貼文、自動發布與同步成效。', 'AI 助理使用 OpenAI 經濟型模型，每月有用量上限；未啟用時會用內建範本。', '「資料管理」可以還原初始資料（無法復原，請小心）。'] },
];

export function guideView() {
  const done = new Set(store('guide.done', []));
  const pct = Math.round(done.size / CHAPTERS.length * 100);
  return `<div class="guide-layout"><aside class="guide-toc panel"><div class="source-progress" style="margin-top:0"><span>學習進度</span><strong>${done.size} / ${CHAPTERS.length}</strong></div><div class="progress-track"><span style="width:${pct}%"></span></div>
    <ol>${CHAPTERS.map((chapter, index) => `<li class="${done.has(chapter.id) ? 'done' : ''}"><a href="#guide-${chapter.id}" data-guide-anchor>${done.has(chapter.id) ? icon('check', 12) : index + 1}<span>${esc(chapter.title.split('：')[0])}</span></a></li>`).join('')}</ol></aside>
  <div class="guide-main"><section class="panel guide-intro"><span class="eyebrow muted">HANDBOOK</span><h2>第一次使用？照著這份手冊走一遍</h2><p class="body-copy">每一章都會說明這個功能可以做到什麼、怎麼操作，最後有按鈕直接帶你去實際操作。學會了就勾選「我學會了」，進度只存在這台電腦。</p></section>
  ${CHAPTERS.map((chapter, index) => `<section class="panel guide-chapter ${done.has(chapter.id) ? 'done' : ''}" id="guide-${chapter.id}"><div class="guide-head"><span class="guide-icon">${icon(chapter.icon, 19)}</span><div><span class="eyebrow muted">第 ${index + 1} 章</span><h2>${esc(chapter.title)}</h2></div></div>
    <div class="grid cols-2"><div><h3 class="section-title">可以做到</h3><ul class="checklist">${chapter.can.map(item => `<li>${icon('check', 14)}${esc(item)}</li>`).join('')}</ul></div>
    <div><h3 class="section-title">怎麼操作</h3><ol class="guide-steps">${chapter.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>${chapter.extra || ''}</div></div>
    <div class="guide-foot"><a class="btn small primary" href="${chapter.href}">${esc(chapter.go)} ${icon('arrow-right', 12)}</a><label class="inline-toggle" style="margin:0"><input type="checkbox" data-action="guide-done" data-id="${chapter.id}" ${done.has(chapter.id) ? 'checked' : ''}>我學會了</label></div></section>`).join('')}</div></div>`;
}
