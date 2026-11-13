// 品牌診斷用的三個庫：溝通語氣庫、核心客群庫、一般餐車基準。
// 初稿，待團隊修訂。修改規則與步驟見 .claude/skills/brand-libraries/SKILL.md。
// 這個檔案同時給前端（滑過標籤顯示定義與範例）和 Worker（限制 AI 只能從庫裡挑、驗證輸出）使用。
// ⚠ id 一旦上線就不要改：已建立的 Brand DNA 用 label 對回庫裡的項目，改 id 或 label 會讓舊診斷對不到說明。

/** 溝通語氣庫：AI 從這裡挑 3–5 個。definition 說明怎麼寫，example 是一句餐車情境的示範。 */
export const TONES = [
  { id: 'warm', label: '溫暖親切', definition: '像熟識的老闆跟客人打招呼，用字口語、帶一點關心。', example: '今天風有點大，來碗熱湯麵暖暖身吧，記得多穿件外套喔！' },
  { id: 'playful', label: '幽默俏皮', definition: '用輕鬆的玩笑、諧音或誇飾讓人會心一笑，但不貶低任何人。', example: '炒泡麵今天又被秒殺了，下次請大家手下留「麵」🍜' },
  { id: 'craft', label: '職人專業', definition: '說明做法、食材與堅持，讓人感受到手藝與標準。', example: '肉醬每天早上現熬兩小時，番茄先烤過再下鍋，香氣才會出來。' },
  { id: 'energetic', label: '熱血活力', definition: '節奏快、多用動詞與驚嘆，帶動現場氣氛。', example: '週六市集我們衝第一排！現炒現做，熱騰騰等你來！' },
  { id: 'literary', label: '文青質感', definition: '用畫面和感受描寫，句子短、留白多，少用驚嘆號。', example: '傍晚的光落在鐵板上。一份炒麵，慢慢吃。' },
  { id: 'local', label: '在地人情', definition: '提到街坊、地名與熟客，強調人和人之間的連結。', example: '謝謝巷口的王阿姨每週三來報到，今天偷偷幫你多加了一顆蛋。' },
  { id: 'clear', label: '資訊清楚', definition: '先講重點：時間、地點、價格、怎麼點餐，條列、不繞圈子。', example: '📍 11/16（六）11:00–14:00 大安森林公園 3 號門｜可線上先點，到場報名字取餐。' },
  { id: 'honest', label: '真誠樸實', definition: '不誇大、不喊口號，坦白說明現況與限制。', example: '今天備料比較少，賣完就收攤，沒吃到的朋友真的很抱歉，下週見。' },
  { id: 'caring', label: '溫柔體貼', definition: '主動替顧客著想：天氣、等候時間、飲食需求。', example: '下雨天不用在外面排隊，先線上點好，餐好了手機會通知你。' },
  { id: 'confident', label: '品牌自信', definition: '清楚說出自己的特色與堅持，不靠貶低別人。', example: '我們只做一道招牌麵，因為想把它做到最好。' },
  { id: 'story', label: '故事敘事', definition: '用一段經歷或小故事帶出品牌、夥伴與餐點。', example: '三年前第一次出車只賣出 12 份；今天，是我們的第 500 場。' },
  { id: 'trendy', label: '潮流年輕', definition: '適量使用年輕族群熟悉的流行語和節奏，不硬塞網路梗。', example: '這盤炒泡麵，本週 comfort food 第一名，不接受反駁。' },
  { id: 'festive', label: '節慶歡樂', definition: '配合節日營造熱鬧感與儀式感。', example: '中秋限定組合上場！帶一份回家，跟家人一起過節。' },
  { id: 'grateful', label: '感恩回饋', definition: '時常感謝顧客、夥伴與合作對象，讓人覺得被記得。', example: '謝謝每一位排隊的你，你們的一句「好吃」是我們出車的動力。' },
  { id: 'inviting', label: '邀請互動', definition: '用提問、投票或留言邀請顧客參與。', example: '下週想吃哪一道？留言告訴我們，最多人選的就上菜單！' },
  { id: 'reassuring', label: '健康安心', definition: '說明食材來源、衛生與用油，讓人吃得放心；不做任何療效或功效宣稱。', example: '蔬菜當天早上進貨，炸油每天更換，吃得安心。' },
  { id: 'value', label: '實惠划算', definition: '直接講份量、價格與 CP 值，讓人一看就知道划算在哪。', example: 'NT$100 一大盤，加蛋不加價，學生午餐的好朋友。' },
  { id: 'calm', label: '沉穩內斂', definition: '語氣平穩、用字精簡，少用驚嘆號與表情符號。', example: '本週照常出車，菜單不變。期待與您見面。' },
  { id: 'inclusive', label: '友善共融', definition: '尊重每一位夥伴與顧客，用平等、不煽情的口吻談公益與多元。', example: '這週由小安負責煎台，他練了三個月，請大家來嚐嚐他的手藝。' },
  { id: 'adventurous', label: '新奇嘗鮮', definition: '強調限定、實驗口味與驚喜，邀人來挑戰。', example: '本週實驗新口味：麻辣起司炒泡麵，敢不敢來挑戰？' },
];

/** 核心客群庫：AI 從這裡挑 3 個，並另外寫一句「這台餐車的這群人在什麼情境會買」。 */
export const AUDIENCES = [
  { id: 'office-lunch', label: '上班族午餐', definition: '平日中午在辦公區附近，時間有限，想快速吃飽、吃得好。', example: '12:10 下樓，希望 15 分鐘內拿到餐，回座位邊吃邊休息。' },
  { id: 'students', label: '學生族群', definition: '學校周邊、預算有限，重視份量與 CP 值，常結伴來。', example: '下課後三五好友一起來，一人一份再加顆蛋。' },
  { id: 'market-goers', label: '市集遊客', definition: '週末逛市集或活動，邊走邊吃，願意嘗鮮。', example: '週六下午逛文創市集，看到有人排隊就想試試看。' },
  { id: 'families', label: '親子家庭', definition: '假日帶小孩出遊，在意口味溫和、衛生和能不能分著吃。', example: '週日在公園野餐，買兩份全家一起分。' },
  { id: 'night-owls', label: '夜貓宵夜族', definition: '加班或下班後的晚上，想找熱食填肚子。', example: '晚上十點下班，經過時想帶一份回家當宵夜。' },
  { id: 'event-crowds', label: '活動人潮', definition: '演唱會、球賽、廟會等短時間大量人潮，最在意快。', example: '演唱會散場，想在人潮裡最快拿到餐。' },
  { id: 'tourists', label: '觀光旅客', definition: '外地或外國旅客，想吃在地特色，需要清楚的菜單與價格。', example: '日本旅客看英文菜單，點一份台味炒麵拍照。' },
  { id: 'regulars', label: '社區熟客', definition: '住在附近、固定時間出現，重視熟悉感和人情味。', example: '每週三固定來買，老闆記得他不要辣。' },
  { id: 'fitness', label: '健身運動族', definition: '運動後補充，在意蛋白質、份量與食材。', example: '晨跑完想吃一份加倍肉量的餐。' },
  { id: 'social-good', label: '理念支持者', definition: '認同品牌理念（友善就業、在地農業、環保），願意用消費支持。', example: '看到餐車的故事後，特地帶朋友來支持。' },
  { id: 'foodies', label: '美食探險家', definition: '追蹤美食帳號、主動找新店，愛拍照分享。', example: '看到 IG 推薦特地搭車來吃，順手上傳限時動態。' },
  { id: 'group-orders', label: '團體訂餐', definition: '公司、社團或活動一次訂多份，重視準時與品質穩定。', example: '公司週五聚會訂 30 份，指定 12 點整取餐。' },
  { id: 'commuters', label: '通勤路過族', definition: '上下班經過車站或路口，順手外帶。', example: '捷運站出口看到餐車，帶一份當晚餐。' },
  { id: 'diet-aware', label: '飲食需求族', definition: '吃素、不吃牛、過敏或少油少鹽，需要清楚標示才敢點。', example: '吃蛋奶素的上班族，先確認哪幾道可以點。' },
  { id: 'seniors', label: '長輩族群', definition: '退休或年長顧客，偏好口味清淡、說明清楚、不用久等。', example: '早上運動完的阿伯，想要一份軟一點、不太鹹的麵。' },
];

/**
 * 一般餐車基準：差異化優勢＝本店跟這份基準比較後「優於一般」的項目。
 * 這是團隊整理的經驗值，不是統計調查；畫面上會標示「參考基準」。
 * method: 'data' 由系統用實際資料判斷（菜單、會員、貼文、出攤）；'ai' 由 AI 讀資料中心判斷（沒有 AI 時用關鍵字粗估）。
 */
export const BASELINE = [
  { id: 'signature', label: '招牌品項', typical: '品項多但沒有明確招牌，或是到處都吃得到的常見小吃。', method: 'ai' },
  { id: 'ingredients', label: '食材與製作', typical: '使用一般批發食材，部分預先做好再加熱。', method: 'ai' },
  { id: 'price', label: '價格與份量', typical: '單品約 NT$80–150，份量中等。', method: 'ai' },
  { id: 'story', label: '品牌故事與理念', typical: '多半沒有對外說明品牌故事或經營理念。', method: 'ai' },
  { id: 'venue', label: '出攤場域', typical: '固定一兩個點位，客源以路過為主。', method: 'ai' },
  { id: 'ordering', label: '點餐與等候', typical: '現場排隊點餐、口頭叫號，要等多久不透明。', method: 'data' },
  { id: 'membership', label: '會員與回訪', typical: '沒有會員制度，熟客靠老闆記憶，沒有回訪優惠。', method: 'data' },
  { id: 'social', label: '社群經營', typical: '不定期發文，一個月約 2–4 篇。', method: 'data' },
  { id: 'schedule', label: '出攤資訊', typical: '出攤時間地點常在當天或前一晚才臨時公布。', method: 'data' },
  { id: 'language', label: '外語服務', typical: '只有中文菜單，外國旅客不容易點餐。', method: 'data' },
];

export const toneByLabel = label => TONES.find(tone => tone.label === label) || null;
export const audienceByLabel = label => AUDIENCES.find(audience => audience.label === label) || null;
