import { getState, init, dispatch, publicCheck, subscribe, setSubscription, setPollInterval, esc, money, icon, sound } from './client.mjs';
import { TW_DISTRICTS } from './tw-districts.mjs';
import { festiveMark } from './festive.mjs';

const app = document.getElementById('customer-app');
const truck = new URLSearchParams(location.search).get('truck') || null;
const slug = truck || 'haihai';
const keys = { member: `truck.customer.${slug}.member.v2`, order: `truck.customer.${slug}.order.v2`, orders: `truck.customer.${slug}.orders.v3`, inboxSeen: `truck.customer.${slug}.inbox-seen.v1`, lang: 'truck.customer.lang' };
const readSaved = key => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* Private browsing still supports the current visit. */ } };

// Option values are stored in Chinese (the merchant's reports); English is only a display label.
const OPTIONS = {
  gender: [['女', 'Female'], ['男', 'Male'], ['其他', 'Other'], ['不透露', 'Prefer not to say']],
  income: [['2 萬以下', 'Under NT$20k'], ['2–4 萬', 'NT$20–40k'], ['4–6 萬', 'NT$40–60k'], ['6–8 萬', 'NT$60–80k'], ['8–10 萬', 'NT$80–100k'], ['10 萬以上', 'Over NT$100k'], ['不透露', 'Prefer not to say']],
  occupation: [['學生', 'Student'], ['上班族', 'Office worker'], ['服務業', 'Service industry'], ['自由工作者', 'Freelancer'], ['軍公教', 'Public sector'], ['自營／老闆', 'Business owner'], ['家管', 'Homemaker'], ['退休', 'Retired'], ['其他', 'Other']],
  household: [['單身', 'Single'], ['情侶／已婚無子女', 'Couple, no children'], ['有小孩', 'With children'], ['與家人同住', 'Living with family'], ['其他', 'Other']],
  channel: [['Instagram', 'Instagram'], ['Facebook', 'Facebook'], ['路過看到', 'Walked by'], ['朋友推薦', 'A friend'], ['市集／活動', 'Market / event'], ['其他', 'Other']],
  diet: [['素食', 'Vegetarian'], ['不吃辣', 'No spice'], ['不吃牛', 'No beef'], ['海鮮過敏', 'Seafood allergy'], ['少油少鹽', 'Less oil & salt']],
  city: [['台北市', 'Taipei City'], ['新北市', 'New Taipei City'], ['基隆市', 'Keelung City'], ['桃園市', 'Taoyuan City'], ['新竹市', 'Hsinchu City'], ['新竹縣', 'Hsinchu County'], ['苗栗縣', 'Miaoli County'], ['台中市', 'Taichung City'], ['彰化縣', 'Changhua County'], ['南投縣', 'Nantou County'], ['雲林縣', 'Yunlin County'], ['嘉義市', 'Chiayi City'], ['嘉義縣', 'Chiayi County'], ['台南市', 'Tainan City'], ['高雄市', 'Kaohsiung City'], ['屏東縣', 'Pingtung County'], ['宜蘭縣', 'Yilan County'], ['花蓮縣', 'Hualien County'], ['台東縣', 'Taitung County'], ['澎湖縣', 'Penghu County'], ['金門縣', 'Kinmen County'], ['連江縣', 'Lienchiang County']],
};

const T = {
  zh: {
    langToggle: 'EN', langLabel: 'Switch to English', orderOnline: '線上點餐', heroTitle: '先在手機點好，<br>到餐車直接取。', pickup: '餐車自取', noDelivery: '不提供外送',
    join: '加入會員點餐', joinNote: reward => reward ? `填會員資料送 NT$${reward} 折扣碼` : '收到專屬優惠與訊息', guest: '直接點餐', back: '返回', home: '回到點餐首頁',
    memberTitle: '加入會員', memberIntro: '留下稱呼和手機，就能收到專屬優惠、折扣碼與活動訊息。', name: '取餐稱呼', namePh: '例如：小林', phone: '手機號碼', phonePh: '09 開頭共 10 碼',
    optIn: '我願意收到優惠與活動訊息', profileTitle: reward => reward ? `填寫會員資料，送 NT$${reward} 折扣碼` : '填寫會員資料', profileNote: '選填。標「必填」的 5 項填完就能領取，資料只給這台餐車做優惠與服務改善。',
    gender: '性別', birthYear: '出生年（西元）', birthYearShort: '出生年', city: '居住縣市', district: '行政區', districtFirst: '請先選縣市', occupation: '職業', income: '個人月收入', household: '家庭狀況', diet: '飲食偏好（可複選）', dietShort: '飲食偏好', channel: '從哪裡知道我們', choose: '請選擇',
    secBasic: '基本資料', secHome: '居住地區', secWork: '工作與收入', secMore: '其他（選填）', profileProgress: n => `必填 ${n}/5 項`, progressDone: '必填都完成了',
    profileMissing: list => `還差：${list}。`, myProfile: '我的資料', editProfile: '修改資料', editTitle: '修改我的資料', saveChanges: '儲存變更', cancelEdit: '取消',
    profileSaved: '資料已更新，謝謝你！', notFilled: '未填', phoneLocked: '手機號碼是會員帳號，無法自行修改；需要更換請洽餐車人員。', consentGiven: '你先前已同意資料使用說明，之後也可以隨時請店家刪除。',
    consent: '我同意店家使用以上資料提供優惠與改善服務，可隨時要求刪除。', joinSubmit: '加入會員，開始點餐', saving: '處理中…', required: '必填', optional: '選填',
    nameRequired: '請輸入取餐稱呼。', phoneRequired: '請輸入手機號碼。', phoneInvalid: '請輸入有效的台灣手機號碼（09 開頭共 10 碼）。', consentRequired: '填寫會員資料前，請先勾選同意。', profileIncomplete: '請填完性別、出生年、居住縣市、職業與月收入，就能領取折扣碼。',
    hello: name => `你好，${name}`, menuSub: '線上點餐 · 現場取餐', bannerTitle: '點了才開始做，<br>趁熱吃最好吃。', bannerText: '送出後可以在手機上<br>看到製作進度。', locationFallback: '依餐車當日公告地點取餐', takeaway: '自取',
    whatToEat: '今天想吃什麼？', itemCount: n => `共 ${n} 道`, all: '全部', soldOut: '今日售完', add: name => `加入 ${name}`, remove: name => `減少 ${name}`, madeToOrder: '現點現做。', menuEmpty: '菜單準備中，請稍後再來看看。', thanks: '謝謝光臨！', thanksNote: '品項與價格以現場為準。',
    viewCart: '查看購物車', cart: '購物車', closeCart: '關閉購物車', cartEmpty: '購物車是空的。', subtotal: '小計', next: '下一步', payOnSite: '餐車自取 · 取餐時付款',
    checkout: '確認訂單', pickupTitle: '餐車現場取餐', pickupText: '送出後這頁會顯示製作進度，餐好了憑號碼取餐。', pickupInfo: '取餐資訊', memberAs: phone => `會員 · ${phone}`, items: '餐點明細', edit: '修改', note: '備註', notePh: '例如：不要辣、醬分開',
    coupon: '折扣碼', couponPh: '輸入折扣碼', apply: '套用', removeCoupon: '移除', myOffers: '我的優惠', discount: '折扣', total: '總計', units: n => `共 ${n} 份`, submit: '送出訂單', sending: '送出中…', payNote: '付款請於取餐時在餐車現場完成。', pickItem: '請先選擇至少一份餐點。',
    statuses: { new: ['訂單收到囉！', '等餐車接單，這頁會自動更新。'], accepted: ['已接單', '馬上開始做。'], preparing: ['製作中', '好了會在這裡通知你。'], ready: ['可以取餐囉！', '請到餐車報取餐號碼。'], completed: ['已取餐', '謝謝光臨，下次見！'], cancelled: ['訂單已取消', '如有疑問，請與餐車現場人員聯繫。'] },
    progress: ['已送出', '已接單', '製作中', '可取餐', '已完成'], myOrder: '我的訂單', pickupNumber: '你的取餐號碼', live: '狀態會自動更新，不用重新整理', again: '再點一單', orderMissing: '找不到這份訂單', orderMissingText: '訂單可能已經完成很久了，請重新點餐。', reorder: '重新點餐',
    center: '我的會員', offers: '我的優惠', offersEmpty: '目前沒有可用的優惠。', inbox: '訊息', inboxEmpty: '還沒有訊息。', use: '使用', until: date => `${date} 前有效`, minSpend: n => `滿 NT$${n} 可用`, signOut: '登出會員', profileDone: '會員資料已完成，謝謝你！', completeProfile: '填寫資料領折扣碼', saveProfile: '送出資料',
    rewardTitle: '送你一張折扣碼！', rewardText: '結帳時輸入就能使用，也會保存在「我的會員」。', copy: '複製', copied: '已複製', startOrder: '開始點餐', continueOrder: '繼續點餐', codeReady: code => `已套用 ${code}`,
    notFound: '找不到這台餐車', notFoundText: '請確認點餐連結或 QR Code 是否正確。', loadError: '菜單暫時連不上', retry: '重新載入菜單', loading: '載入菜單中…', since: '開業',
    welcomeJoined: name => `歡迎加入，${name}！`, welcomeProfile: reward => `填完會員資料就送 NT$${reward} 折扣碼 →`, continueAs: name => `歡迎回來，${name}`, continueNote: '繼續點餐', notYou: '不是你？登出會員', dismiss: '知道了',
    codeLabel: '6 位數登入碼', codeHelp: '這支手機已經是會員。為了保護會員的優惠，請向餐車人員出示手機號碼，索取一次性登入碼。', codePh: '例如：482913', codeSubmit: '登入會員', guestInstead: '先用訪客點餐（訂單一樣會累積到會員紀錄）',
    soldOutRemoved: names => `「${names}」剛剛售完，已從購物車移除。`, pausedTitle: '目前暫停線上點餐', pausedText: '可以直接到餐車現場點餐，或稍後再回來看看。',
    ahead: n => n ? `前面還有 ${n} 單` : '下一個就輪到你', keepOpen: '請保持這個頁面開著，餐好了手機會震動並發出提示音。', yourOrders: '你的訂單', fullNumber: n => `訂單編號 ${n}`,
    cancelReason: reason => `原因：${reason}`, couponReturned: code => `折扣碼 ${code} 已退回，可以下次再用。`, readyFlash: '🔔 可以取餐囉！',
    statusShort: { new: '已送出', accepted: '已接單', preparing: '製作中', ready: '可取餐', completed: '已完成', cancelled: '已取消' },
    today: '今天', tomorrow: '明天', openNow: '營業中', newMessage: '新',
  },
  en: {
    langToggle: '中文', langLabel: '切換為中文', orderOnline: 'Order online', heroTitle: 'Order on your phone,<br>pick up at the truck.', pickup: 'Pickup at the truck', noDelivery: 'No delivery',
    join: 'Join & order as a member', joinNote: reward => reward ? `Complete your profile, get NT$${reward} off` : 'Get member-only offers', guest: 'Order as a guest', back: 'Back', home: 'Back to start',
    memberTitle: 'Become a member', memberIntro: 'Leave your name and mobile number to receive member offers, discount codes and news.', name: 'Name for pickup', namePh: 'e.g. Lin', phone: 'Mobile number', phonePh: '10 digits starting with 09',
    optIn: 'Send me offers and news', profileTitle: reward => reward ? `Complete your profile, get NT$${reward} off` : 'Complete your profile', profileNote: 'Optional. Answer the 5 “required” questions to claim your code. Only this truck uses it, for offers and better service.',
    gender: 'Gender', birthYear: 'Birth year', birthYearShort: 'Birth year', city: 'City / county', district: 'District', districtFirst: 'Choose a city first', occupation: 'Occupation', income: 'Monthly income', household: 'Household', diet: 'Dietary preferences', dietShort: 'Dietary preferences', channel: 'How did you find us?', choose: 'Select',
    secBasic: 'About you', secHome: 'Where you live', secWork: 'Work & income', secMore: 'More (optional)', profileProgress: n => `${n}/5 required answered`, progressDone: 'All required answers done',
    profileMissing: list => `Still needed: ${list}.`, myProfile: 'My details', editProfile: 'Edit', editTitle: 'Edit my details', saveChanges: 'Save changes', cancelEdit: 'Cancel',
    profileSaved: 'Your details are updated. Thank you!', notFilled: 'Not set', phoneLocked: 'Your mobile number is your membership ID and can’t be changed here. Ask the staff to change it.', consentGiven: 'You have already agreed to how this truck uses your details. You can ask for deletion at any time.',
    consent: 'I agree that the truck may use this information for offers and service improvement. I can ask for it to be deleted at any time.', joinSubmit: 'Join and start ordering', saving: 'Saving…', required: 'required', optional: 'optional',
    nameRequired: 'Please enter a name for pickup.', phoneRequired: 'Please enter your mobile number.', phoneInvalid: 'Please enter a valid Taiwan mobile number (10 digits starting with 09).', consentRequired: 'Please tick the consent box to share your profile.', profileIncomplete: 'Fill in gender, birth year, city, occupation and income to claim your code.',
    hello: name => `Hi, ${name}`, menuSub: 'Order online · Pick up on site', bannerTitle: 'Made to order,<br>best enjoyed hot.', bannerText: 'Follow your order’s<br>progress on your phone.', locationFallback: 'Pickup at the announced location', takeaway: 'Pickup',
    whatToEat: 'What would you like today?', itemCount: n => `${n} items`, all: 'All', soldOut: 'Sold out today', add: name => `Add ${name}`, remove: name => `Remove ${name}`, madeToOrder: 'Made to order.', menuEmpty: 'The menu is on its way. Please check back soon.', thanks: 'Thank you!', thanksNote: 'Items and prices on site prevail.',
    viewCart: 'View cart', cart: 'Cart', closeCart: 'Close cart', cartEmpty: 'Your cart is empty.', subtotal: 'Subtotal', next: 'Next', payOnSite: 'Pickup · Pay at the truck',
    checkout: 'Review your order', pickupTitle: 'Pick up at the truck', pickupText: 'After you order, this page shows the progress. Show your number when it’s ready.', pickupInfo: 'Pickup details', memberAs: phone => `Member · ${phone}`, items: 'Your items', edit: 'Edit', note: 'Notes', notePh: 'e.g. not spicy, sauce on the side',
    coupon: 'Discount code', couponPh: 'Enter a code', apply: 'Apply', removeCoupon: 'Remove', myOffers: 'My offers', discount: 'Discount', total: 'Total', units: n => `${n} items`, submit: 'Place order', sending: 'Sending…', payNote: 'Please pay at the truck when you pick up.', pickItem: 'Please add at least one item.',
    statuses: { new: ['Order received!', 'Waiting for the truck to accept. This page updates by itself.'], accepted: ['Accepted', 'We’re starting on it.'], preparing: ['Being prepared', 'We’ll let you know here when it’s ready.'], ready: ['Ready for pickup!', 'Show your pickup number at the truck.'], completed: ['Picked up', 'Thanks for coming. See you next time!'], cancelled: ['Order cancelled', 'Please ask the staff at the truck if you have questions.'] },
    progress: ['Sent', 'Accepted', 'Cooking', 'Ready', 'Done'], myOrder: 'My order', pickupNumber: 'Your pickup number', live: 'Updates automatically — no need to refresh', again: 'Order again', orderMissing: 'Order not found', orderMissingText: 'It may have been completed a while ago. Please order again.', reorder: 'Order again',
    center: 'My membership', offers: 'My offers', offersEmpty: 'No offers available right now.', inbox: 'Messages', inboxEmpty: 'No messages yet.', use: 'Use', until: date => `Valid until ${date}`, minSpend: n => `Min. spend NT$${n}`, signOut: 'Sign out', profileDone: 'Your profile is complete. Thank you!', completeProfile: 'Complete profile for a code', saveProfile: 'Submit',
    rewardTitle: 'Here’s your discount code!', rewardText: 'Enter it at checkout. It’s also saved in “My membership”.', copy: 'Copy', copied: 'Copied', startOrder: 'Start ordering', continueOrder: 'Continue ordering', codeReady: code => `${code} applied`,
    notFound: 'Food truck not found', notFoundText: 'Please check the ordering link or QR code.', loadError: 'Unable to load the menu', retry: 'Reload menu', loading: 'Loading menu…', since: 'Since',
    welcomeJoined: name => `Welcome, ${name}!`, welcomeProfile: reward => `Complete your profile for NT$${reward} off →`, continueAs: name => `Welcome back, ${name}`, continueNote: 'Continue ordering', notYou: 'Not you? Sign out', dismiss: 'OK',
    codeLabel: '6-digit sign-in code', codeHelp: 'This number is already a member. To protect member offers, show your number to the staff at the truck and ask for a one-time sign-in code.', codePh: 'e.g. 482913', codeSubmit: 'Sign in', guestInstead: 'Order as a guest for now (it still counts for your membership)',
    soldOutRemoved: names => `${names} just sold out and was removed from your cart.`, pausedTitle: 'Online ordering is paused', pausedText: 'You can order at the truck, or check back a little later.',
    ahead: n => n ? `${n} order${n > 1 ? 's' : ''} ahead of you` : 'You’re next', keepOpen: 'Keep this page open. Your phone will buzz and chime when it’s ready.', yourOrders: 'Your orders', fullNumber: n => `Order ${n}`,
    cancelReason: reason => `Reason: ${reason}`, couponReturned: code => `Code ${code} has been returned for next time.`, readyFlash: '🔔 Ready for pickup!',
    statusShort: { new: 'Sent', accepted: 'Accepted', preparing: 'Cooking', ready: 'Ready', completed: 'Done', cancelled: 'Cancelled' },
    today: 'Today', tomorrow: 'Tomorrow', openNow: 'Open now', newMessage: 'New',
  },
};
let lang = readSaved(keys.lang) === 'en' ? 'en' : 'zh';
const t = (key, ...args) => { const value = T[lang][key] ?? T.zh[key]; return typeof value === 'function' ? value(...args) : value; };
const optionLabel = (field, value) => (OPTIONS[field].find(([zh]) => zh === value) || [value, value])[lang === 'en' ? 1 : 0];

let state = null;
let phase = 'entry';
let category = 'all';
const cart = new Map();
let drawer = false;
let busy = false;
let error = '';
let notFound = false;
let ownMemberId = readSaved(keys.member);
/** Orders this device follows (newest first). Ordering again keeps following the earlier ones. */
let ownOrderIds = (() => {
  try { const saved = JSON.parse(readSaved(keys.orders) || '[]'); if (Array.isArray(saved) && saved.length) return saved.filter(id => typeof id === 'string').slice(0, 5); } catch { /* fall back below */ }
  const legacy = readSaved(keys.order);
  return legacy ? [legacy] : [];
})();
let viewOrderId = ownOrderIds[0] || null;
function saveOrders() { save(keys.orders, ownOrderIds.length ? JSON.stringify(ownOrderIds) : null); save(keys.order, null); }
const FINISHED = ['completed', 'cancelled'];
let notice = '';
let needCode = false;
const form = { name: '', phone: '', note: '', coupon: '', loginCode: '', editName: '' };
const profile = { gender: '', birthYear: '', city: '', district: '', occupation: '', income: '', household: '', diet: [], channel: '' };
/** The 5 answers needed for the profile reward, in the order the form asks them. */
const REQUIRED = ['gender', 'birthYear', 'city', 'occupation', 'income'];
let consent = false;
/** A member with a complete profile is editing it in 「我的會員」. */
let profileEditing = false;
let optIn = true;
let applied = null;
let couponError = '';
let reward = null;
let copied = false;

function imageUrl(value) {
  const url = String(value || '').trim();
  return /^(https?:\/\/|\/[^/]|data:image\/|blob:)/i.test(url) ? url : '';
}
const brand = () => state?.brand || {};
const brandName = () => (lang === 'en' && brand().nameEn) || brand().name || '';
const brandShort = () => (lang === 'en' && brand().nameEn) || brand().shortName || brand().name || '';
const brandDescription = () => (lang === 'en' && brand().descriptionEn) || brand().description || '';
const menu = () => (Array.isArray(state?.menu) ? state.menu : []);
const itemName = item => (lang === 'en' && item?.nameEn) || item?.name || '';
const itemDescription = item => (lang === 'en' && item?.descriptionEn) || item?.description || '';
const itemCategory = item => (lang === 'en' ? item?.categoryEn || item?.category : item?.category) || (lang === 'en' ? 'Menu' : '精選餐點');
// The public view carries only this visitor's own member/order records.
const member = () => (state?.member && state.member.id === ownMemberId ? state.member : null);
const myOrders = () => (Array.isArray(state?.myOrders) ? state.myOrders : state?.order ? [state.order] : []).filter(order => ownOrderIds.includes(order.id));
const activeOrders = () => myOrders().filter(order => !FINISHED.includes(order.status));
const viewedOrder = () => myOrders().find(order => order.id === viewOrderId) || null;
const paused = () => Boolean(state?.ordering?.paused);
const shortNumber = number => { const value = String(number || ''); return value.includes('-') ? value.split('-').pop() : value; };
const followOrders = () => { setSubscription({ order: ownOrderIds.join(',') || null }); setPollInterval(activeOrders().length || ownOrderIds.length ? 5000 : 30000); };
const inboxSeen = () => readSaved(keys.inboxSeen) || '';
let centerSeenBefore = '';
function markInboxSeen() {
  centerSeenBefore = inboxSeen();
  const latest = (state?.inbox || []).map(message => String(message.sentAt)).sort().pop();
  if (latest && latest > centerSeenBefore) save(keys.inboxSeen, latest);
}
const unreadInbox = () => (state?.inbox || []).filter(message => String(message.sentAt) > inboxSeen()).length;
function cartLines() {
  return [...cart].map(([id, quantity]) => {
    const item = menu().find(entry => entry.id === id);
    return item && !item.soldOut ? { ...item, quantity } : null;
  }).filter(Boolean);
}
const subtotal = () => cartLines().reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
const count = () => cartLines().reduce((sum, item) => sum + item.quantity, 0);
const discount = () => Math.min(subtotal(), applied?.amount || 0);
const dateText = value => new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-TW', { month: lang === 'en' ? 'short' : '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).format(new Date(value));
const profileReward = () => Number(state?.rewards?.profileReward || 0);
const isFlagship = () => slug === 'haihai';

function errorMessage(message = error, kind = 'general') { return message ? `<div class="customer-error" role="alert" data-kind="${kind}">${esc(message)}</div>` : ''; }
function noticeBox() { return notice ? `<div class="customer-notice" role="status"><span>${notice}</span><button type="button" data-action="dismiss-notice">${t('dismiss')}</button></div>` : ''; }
function pausedBanner() { return paused() ? `<div class="customer-paused" role="status">${icon('clock', 18)}<div><strong>${t('pausedTitle')}</strong><p>${esc(state.ordering.message || t('pausedText'))}</p></div></div>` : ''; }
const QUEUE = ['new', 'accepted', 'preparing'];
const recentlyChanged = order => Date.now() - Date.parse(order.updatedAt || order.createdAt) < 30 * 60000;
/** Status strip of the orders this device follows, shown above the menu so a customer can always get back to them. */
function orderStrip() {
  const rows = myOrders().filter(order => !FINISHED.includes(order.status) || (order.status === 'cancelled' && recentlyChanged(order)));
  if (!rows.length) return '';
  return `<div class="customer-order-strips">${rows.map(order => `<button class="customer-order-strip ${order.status === 'ready' ? 'is-ready' : ''} ${order.status === 'cancelled' ? 'is-cancelled' : ''}" data-action="view-order" data-id="${esc(order.id)}">${icon(order.status === 'ready' ? 'bell' : 'shopping-bag', 16)}<span><strong>${esc(shortNumber(order.number))}</strong> · ${esc(t('statusShort')[order.status] || '')}${QUEUE.includes(order.status) ? ` · ${esc(t('ahead', Number(order.ahead || 0)))}` : ''}</span>${icon('arrow-right', 15)}</button>`).join('')}</div>`;
}
function stallWhen(stall) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 32 * 3600000).toISOString().slice(0, 10);
  const day = stall.date === today ? t('today') : stall.date === tomorrow ? t('tomorrow') : new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-TW', { month: lang === 'en' ? 'short' : 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Taipei' }).format(new Date(`${stall.date}T12:00:00+08:00`));
  const now = new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 16);
  const open = stall.date === today && stall.start <= now && (!stall.end || now < stall.end);
  return `${esc(day)} ${esc(stall.start || '')}${stall.end ? `–${esc(stall.end)}` : ''}${open ? ` · <b class="customer-open-now">${t('openNow')}</b>` : ''}`;
}
function langButton() { return `<button class="customer-lang" data-action="lang" aria-label="${esc(t('langLabel'))}">${icon('globe', 14)}<span>${t('langToggle')}</span></button>`; }
function pageHeader(title = '', backAction = 'menu') {
  return `<header class="customer-topbar"><button class="customer-icon-button" data-action="${backAction}" aria-label="${esc(t('back'))}">${icon('arrow-left')}</button><span>${esc(title || brandName())}</span>${langButton()}</header>`;
}
function foodImage(item, className = '') {
  const src = imageUrl(item?.image);
  // The flagship's historical menu photo shows three dishes; crop the matching one when an item has no photo of its own.
  if (isFlagship() && !src && item?.name) {
    const crop = item.name.includes('泡麵') ? '26 286 211 217' : item.name.includes('烏龍') ? '249 289 209 216' : item.name.includes('義大利') ? '463 286 208 219' : null;
    if (crop) return `<svg class="customer-food-crop ${className}" viewBox="${crop}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(itemName(item))}"><image href="/static/truck/brand/menu-official-2021.webp" x="0" y="0" width="794" height="559" /></svg>`;
  }
  return src ? `<img class="${className}" src="${esc(src)}" alt="${esc(itemName(item) || brandName())}" loading="lazy" decoding="async" data-fallback>` : `<div class="customer-food-fallback ${className}" aria-hidden="true">${icon('leaf', 38)}</div>`;
}

function renderEntry() {
  const cover = brand().coverImage;
  const reward = profileReward();
  return `<div class="customer-entry">
    <header class="customer-entry-top"><span class="customer-wordmark">${festiveMark(icon('truck', 24))}<span>${esc(brandShort())}<small>${esc((brand().nameEn || 'FOOD TRUCK').toUpperCase())}</small></span></span>${langButton()}</header>
    <div class="customer-hero"><div class="customer-hero-photo">${cover ? `<img src="${esc(cover)}" alt="${esc(brandName())}">` : `<div class="customer-food-fallback">${icon('truck', 54)}</div>`}${brand().tagline ? `<span class="customer-hero-tag">${icon('heart', 13)} ${esc(brand().tagline)}</span>` : ''}</div>${brand().since ? `<span class="customer-hero-stamp">OPEN<br>SINCE<br>${esc(brand().since)} <i>✳</i></span>` : ''}</div>
    <div class="customer-intro"><p class="customer-eyebrow">ORDER AHEAD</p><h1>${t('heroTitle')}</h1>${brandDescription() ? `<p class="customer-intro-description">${esc(brandDescription())}</p>` : ''}<div class="customer-pickup-label">${icon('map-pin', 15)} ${t('pickup')} <span>·</span> ${t('noDelivery')}</div></div>
    <div class="customer-entry-actions">${orderStrip()}${pausedBanner()}${member()
      ? `<button class="customer-line-button" data-action="menu"><span class="customer-join-icon">${icon('user', 24)}</span><span>${esc(t('continueAs', member().name))}<small>${state?.offers?.length ? `${esc(t('myOffers'))} · ${state.offers.length}` : t('continueNote')}</small></span>${icon('arrow-right', 20)}</button><button class="customer-guest-button" data-action="member-center">${t('center')} ${icon('arrow-right', 16)}</button><button class="customer-text-button" data-action="sign-out">${t('notYou')}</button>`
      : `<button class="customer-line-button" data-action="member-entry"><span class="customer-join-icon">${icon('gift', 24)}</span><span>${t('join')}<small>${esc(t('joinNote', reward))}</small></span>${icon('arrow-right', 20)}</button><button class="customer-guest-button" data-action="guest">${t('guest')} ${icon('arrow-right', 16)}</button>`}</div>
  </div>`;
}

const requiredTag = () => `<em class="customer-required">${t('required')}</em>`;
function select(field, labelKey, { required = false, autocomplete = '' } = {}) {
  return `<label>${t(labelKey)}${required ? requiredTag() : ''}<select data-profile="${field}" name="${field}" ${autocomplete ? `autocomplete="${autocomplete}"` : ''}><option value="">${t('choose')}</option>${OPTIONS[field].map(([value, en]) => `<option value="${esc(value)}" ${profile[field] === value ? 'selected' : ''}>${esc(lang === 'en' ? en : value)}</option>`).join('')}</select></label>`;
}
/** Gender as tap targets: one tap instead of opening a picker. */
function pills(field, labelKey) {
  return `<fieldset class="customer-pills"><legend>${t(labelKey)}${requiredTag()}</legend><div>${OPTIONS[field].map(([value, en]) => `<label><input type="radio" name="${field}" data-profile="${field}" value="${esc(value)}" ${profile[field] === value ? 'checked' : ''}><span>${esc(lang === 'en' ? en : value)}</span></label>`).join('')}</div></fieldset>`;
}
function birthYearSelect() {
  const newest = new Date().getFullYear() - 8;
  const years = Array.from({ length: newest - 1920 + 1 }, (_, index) => newest - index);
  return `<label>${t('birthYear')}${requiredTag()}<select data-profile="birthYear" name="birthYear" autocomplete="bday-year"><option value="">${t('choose')}</option>${years.map(year => `<option value="${year}" ${String(profile.birthYear) === String(year) ? 'selected' : ''}>${year}</option>`).join('')}</select></label>`;
}
/** Districts follow the chosen city: nothing to pick until a city is chosen, and only that city's districts after. */
function districtSelect() {
  const list = TW_DISTRICTS[profile.city] || [];
  return `<label>${t('district')}<select data-profile="district" name="district" autocomplete="address-level2" ${list.length ? '' : 'disabled'}><option value="">${list.length ? t('choose') : t('districtFirst')}</option>${list.map(name => `<option value="${esc(name)}" ${profile.district === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
}
const requiredDone = () => REQUIRED.filter(key => profile[key]).length;
function profileFields({ consented = false } = {}) {
  const done = requiredDone();
  return `<div class="customer-profile-progress ${done === REQUIRED.length ? 'is-done' : ''}"><span class="customer-profile-meter"><i style="width:${done / REQUIRED.length * 100}%"></i></span><small>${done === REQUIRED.length ? t('progressDone') : t('profileProgress', done)}</small></div>
    <section class="customer-profile-section"><h3>${t('secBasic')}</h3>${pills('gender', 'gender')}<div class="customer-profile-grid">${birthYearSelect()}</div></section>
    <section class="customer-profile-section"><h3>${t('secHome')}</h3><div class="customer-profile-grid">${select('city', 'city', { required: true, autocomplete: 'address-level1' })}${districtSelect()}</div></section>
    <section class="customer-profile-section"><h3>${t('secWork')}</h3><div class="customer-profile-grid">${select('occupation', 'occupation', { required: true })}${select('income', 'income', { required: true })}</div></section>
    <section class="customer-profile-section"><h3>${t('secMore')}</h3><div class="customer-profile-grid">${select('household', 'household')}${select('channel', 'channel')}</div>
    <fieldset class="customer-checks"><legend>${t('diet')}</legend>${OPTIONS.diet.map(([value, en]) => `<label class="customer-check"><input type="checkbox" data-diet="${esc(value)}" ${profile.diet.includes(value) ? 'checked' : ''}><span>${esc(lang === 'en' ? en : value)}</span></label>`).join('')}</fieldset></section>
    ${consented ? `<p class="customer-consent-note">${icon('check', 13)} ${t('consentGiven')}</p>` : `<label class="customer-check customer-consent"><input type="checkbox" data-flag="consent" ${consent ? 'checked' : ''}><span>${t('consent')}</span></label>`}`;
}
const profileTouched = () => Object.entries(profile).some(([key, value]) => key === 'diet' ? value.length : value);
const profileReady = () => REQUIRED.every(key => profile[key]);
const missingLabels = () => REQUIRED.filter(key => !profile[key]).map(key => t(key === 'birthYear' ? 'birthYearShort' : key)).join(lang === 'en' ? ', ' : '、');
function profilePayload() {
  return { ...profile, diet: [...profile.diet], birthYear: profile.birthYear ? Number(profile.birthYear) : null };
}
/** Fills the form with what the member already saved (their own record only). */
function loadProfile(me = member()) {
  const saved = me?.demographics;
  if (!saved) return;
  for (const key of Object.keys(profile)) profile[key] = key === 'diet' ? [...(saved.diet || [])] : key === 'birthYear' ? (saved.birthYear ? String(saved.birthYear) : '') : String(saved[key] || '');
}
const consented = () => Boolean(member()?.demographics);
function profileSummary(me) {
  const saved = me.demographics || {};
  const label = (field, value) => value ? optionLabel(field, value) : '';
  const rows = [
    [t('name'), me.name], [t('phone'), me.phone], [t('gender'), label('gender', saved.gender)], [t('birthYearShort'), saved.birthYear || ''],
    [t('city'), [label('city', saved.city), saved.district].filter(Boolean).join(' ')], [t('occupation'), label('occupation', saved.occupation)], [t('income'), label('income', saved.income)],
    [t('household'), label('household', saved.household)], [t('channel'), label('channel', saved.channel)], [t('dietShort'), (saved.diet || []).map(value => optionLabel('diet', value)).join(lang === 'en' ? ', ' : '、')],
  ];
  return `<dl class="customer-profile-summary">${rows.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${value ? esc(String(value)) : `<span>${t('notFilled')}</span>`}</dd></div>`).join('')}</dl>`;
}

function renderMember() {
  const reward = profileReward();
  return `${pageHeader(t('memberTitle'), 'entry')}<main class="customer-page customer-member-page"><div class="customer-line-symbol">${icon('gift', 40)}</div><p class="customer-eyebrow">MEMBERSHIP</p><h1>${t('memberTitle')}</h1><p class="customer-muted">${t('memberIntro')}</p>
    <form class="customer-form" data-form="member" novalidate><label>${t('name')} <span>*</span><input name="name" data-field="name" autocomplete="given-name" maxlength="30" placeholder="${esc(t('namePh'))}" value="${esc(form.name)}" required></label>
      <label>${t('phone')} <span>*</span><input name="phone" data-field="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="${esc(t('phonePh'))}" value="${esc(form.phone)}" required></label>
      ${needCode ? `<div class="customer-code-field"><p>${icon('lock', 15)} ${t('codeHelp')}</p><label>${t('codeLabel')} <span>*</span><input name="loginCode" data-field="loginCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="${esc(t('codePh'))}" value="${esc(form.loginCode)}"></label></div>` : `<label class="customer-check"><input type="checkbox" data-flag="optIn" ${optIn ? 'checked' : ''}><span>${t('optIn')}</span></label>
      <details class="customer-profile" ${profileTouched() ? 'open' : ''}><summary><span class="customer-profile-gift">${icon('gift', 18)}</span><span><strong>${esc(t('profileTitle', reward))}</strong><small>${t('profileNote')}</small></span>${icon('arrow-right', 16)}</summary>${profileFields()}</details>`}
      ${errorMessage()}<button class="customer-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? t('saving') : needCode ? t('codeSubmit') : t('joinSubmit')} ${icon('arrow-right', 18)}</button>${needCode ? `<button type="button" class="customer-guest-button" data-action="guest-with-phone">${t('guestInstead')}</button>` : ''}</form></main>`;
}

function quantityControls(item, compact = false) {
  const quantity = Number(cart.get(item.id) || 0);
  return `<div class="customer-quantity ${compact ? 'is-compact' : ''}">${quantity ? `<button data-action="remove" data-id="${esc(item.id)}" aria-label="${esc(t('remove', itemName(item)))}" ${busy ? 'disabled' : ''}>${icon('minus', 15)}</button><span aria-live="polite">${quantity}</span>` : ''}<button data-action="add" data-id="${esc(item.id)}" aria-label="${esc(t('add', itemName(item)))}" ${busy || paused() ? 'disabled' : ''}>${icon('plus', 17)}</button></div>`;
}
function nextStall() {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return [...(state?.stalls || [])].filter(stall => String(stall.date) >= today).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))[0];
}
function renderMenu() {
  const categories = ['all', ...new Set(menu().map(itemCategory))];
  if (!categories.includes(category)) category = 'all';
  const filtered = menu().filter(item => category === 'all' || itemCategory(item) === category);
  const stall = nextStall();
  const me = member();
  return `<header class="customer-menu-header"><div class="customer-menu-brand">${festiveMark(`<span class="customer-brand-symbol">${icon('truck', 23)}</span>`)}<div><h1>${esc(brandName())}</h1><p>${me ? esc(t('hello', me.name)) : t('menuSub')}</p></div></div><div class="customer-header-actions">${langButton()}${me ? `<button class="customer-icon-button" data-action="member-center" aria-label="${esc(t('center'))}">${icon('user', 21)}${(state?.offers?.length || 0) + unreadInbox() ? `<i class="customer-dot">${(state?.offers?.length || 0) + unreadInbox()}</i>` : ''}</button>` : ''}<button class="customer-icon-button" data-action="entry" aria-label="${esc(t('home'))}">${icon('home', 21)}</button></div></header>
    <main class="customer-menu-main"><div class="customer-menu-banner"><div><p class="customer-eyebrow">MADE TO ORDER</p><h2>${t('bannerTitle')}</h2><p>${t('bannerText')}</p></div><div class="customer-menu-banner-image">${foodImage(menu().find(item => imageUrl(item.image)) || menu()[0] || { image: brand().coverImage })}</div><span class="customer-banner-flower">✳</span></div>
    <div class="customer-location">${icon('map-pin', 17)}<span>${esc(stall?.location || brand().location || t('locationFallback'))}${stall ? `<small>${stallWhen(stall)}</small>` : ''}</span><span class="customer-takeaway-tag">${t('takeaway')}</span></div>
    ${orderStrip()}${noticeBox()}${pausedBanner()}
    ${me && state?.offers?.length ? `<button class="customer-offer-strip" data-action="member-center">${icon('tag', 16)}<span>${esc(t('myOffers'))} · ${esc(state.offers[0].label)}${state.offers.length > 1 ? ` +${state.offers.length - 1}` : ''}</span>${icon('arrow-right', 15)}</button>` : ''}
    <div class="customer-menu-title"><h2>${t('whatToEat')}</h2><span>${t('itemCount', menu().length)}</span></div><nav class="customer-categories" aria-label="menu categories">${categories.map(name => `<button data-action="category" data-id="${esc(name)}" class="${category === name ? 'is-active' : ''}" aria-pressed="${category === name}">${esc(name === 'all' ? t('all') : name)}</button>`).join('')}</nav>
    <div class="customer-menu-items">${filtered.length ? filtered.map(item => `<article class="customer-menu-card ${item.soldOut ? 'is-unavailable' : ''}"><div class="customer-menu-photo">${foodImage(item)}${item.soldOut ? `<span class="customer-sold-out">${t('soldOut')}</span>` : ''}</div><div class="customer-menu-copy"><span class="customer-item-category">${esc(itemCategory(item))}</span><h3>${esc(itemName(item))}</h3>${lang === 'en' && item.nameEn ? `<span class="customer-item-zh" lang="zh-Hant">${esc(item.name)}</span>` : ''}<p>${esc(itemDescription(item) || t('madeToOrder'))}</p><div class="customer-menu-card-footer"><strong>${money(Number(item.price || 0))}</strong>${item.soldOut ? `<span class="customer-unavailable-label">${t('soldOut')}</span>` : quantityControls(item)}</div></div></article>`).join('') : `<div class="customer-empty">${t('menuEmpty')}</div>`}</div>
    <div class="customer-menu-footer">${icon('heart', 15)} ${t('thanks')}<span>${t('thanksNote')}</span></div></main>
    ${count() ? `<div class="customer-cart-bar"><button data-action="cart"><span class="customer-cart-count">${count()}</span><span>${t('viewCart')}</span><strong>${money(subtotal())}</strong>${icon('arrow-right', 20)}</button></div>` : ''}${drawer ? renderCart() : ''}`;
}

function renderCart() {
  return `<div class="customer-cart-overlay"><button class="customer-scrim" data-action="close-cart" aria-label="${esc(t('closeCart'))}"></button><section class="customer-cart-sheet" role="dialog" aria-modal="true" aria-label="${esc(t('cart'))}"><div class="customer-sheet-handle"></div><div class="customer-sheet-heading"><h2>${t('cart')} <span>${count()}</span></h2><button class="customer-close" data-action="close-cart" aria-label="${esc(t('closeCart'))}">×</button></div><div class="customer-cart-lines">${cartLines().map(item => `<div class="customer-cart-line"><div class="customer-cart-image">${foodImage(item)}</div><div class="customer-cart-line-copy"><h3>${esc(itemName(item))}</h3><p>${money(Number(item.price || 0))}</p></div>${quantityControls(item, true)}</div>`).join('') || `<p class="customer-muted">${t('cartEmpty')}</p>`}</div><div class="customer-cart-summary"><span>${t('subtotal')}</span><strong>${money(subtotal())}</strong></div><p class="customer-small-note">${t('payOnSite')}</p><button class="customer-primary" data-action="checkout" ${count() ? '' : 'disabled'}>${t('next')} ${icon('arrow-right', 18)}</button></section></div>`;
}

function offerMeta(offer) {
  return [offer.expiresAt ? t('until', dateText(offer.expiresAt)) : '', offer.minSpend ? t('minSpend', offer.minSpend) : ''].filter(Boolean).join(' · ');
}
function renderCheckout() {
  const me = member();
  const offers = me ? state?.offers || [] : [];
  return `${pageHeader(t('checkout'))}<main class="customer-page customer-checkout"><p class="customer-eyebrow">CHECKOUT</p><h1>${t('checkout')}</h1>${noticeBox()}${pausedBanner()}<div class="customer-checkout-pickup">${icon('shopping-bag', 24)}<div><strong>${t('pickupTitle')}</strong><p>${t('pickupText')}</p></div></div>
    <form class="customer-form" data-form="checkout" novalidate><section class="customer-checkout-section"><h2>${t('pickupInfo')}</h2><label>${t('name')} <span>*</span><input data-field="name" name="name" value="${esc(form.name)}" maxlength="30" autocomplete="given-name" placeholder="${esc(t('namePh'))}" required ${busy ? 'disabled' : ''}></label>
      ${me ? `<p class="customer-member-line">${icon('user', 15)} ${esc(t('memberAs', me.phone))}</p>` : `<label>${t('phone')} <span>*</span><input data-field="phone" name="phone" type="tel" inputmode="tel" value="${esc(form.phone)}" maxlength="20" autocomplete="tel" placeholder="${esc(t('phonePh'))}" required ${busy ? 'disabled' : ''}></label>`}</section>
    <section class="customer-checkout-section"><h2>${t('items')} <button type="button" data-action="edit-cart">${t('edit')}</button></h2>${cartLines().map(item => `<div class="customer-checkout-line"><span><b>${item.quantity}</b>${esc(itemName(item))}</span><strong>${money(Number(item.price || 0) * item.quantity)}</strong></div>`).join('')}<label class="customer-note-label">${t('note')} <small>${t('optional')}</small><textarea name="note" data-field="note" rows="3" maxlength="200" placeholder="${esc(t('notePh'))}" ${busy ? 'disabled' : ''}>${esc(form.note)}</textarea></label></section>
    <section class="customer-checkout-section customer-coupon"><h2>${t('coupon')}</h2>${applied ? `<div class="customer-coupon-applied">${icon('tag', 16)}<span><strong>${esc(applied.code)}</strong><small>${esc(applied.label)}${applied.minSpend && !String(applied.label).includes(String(applied.minSpend)) ? `（${esc(t('minSpend', applied.minSpend))}）` : ''}</small></span><b>−${money(discount())}</b><button type="button" data-action="remove-coupon">${t('removeCoupon')}</button></div>` : `<div class="customer-coupon-row"><input name="coupon" data-field="coupon" maxlength="20" autocapitalize="characters" autocomplete="off" placeholder="${esc(t('couponPh'))}" value="${esc(form.coupon)}" ${busy ? 'disabled' : ''}><button type="button" data-action="apply-coupon" ${busy ? 'disabled' : ''}>${t('apply')}</button></div>`}${couponError ? errorMessage(couponError, 'coupon') : ''}
      ${offers.length && !applied ? `<p class="customer-offers-label">${t('myOffers')}</p><div class="customer-offer-chips">${offers.map(offer => `<button type="button" data-action="use-offer" data-id="${esc(offer.code)}">${icon('gift', 13)}<span>${esc(offer.label)}<small>${esc(offerMeta(offer))}</small></span></button>`).join('')}</div>` : ''}</section>
    <div class="customer-checkout-sum"><div><span>${t('subtotal')} <small>${t('units', count())}</small></span><span>${money(subtotal())}</span></div>${applied ? `<div class="is-discount"><span>${t('discount')}（${esc(applied.code)}）</span><span>−${money(discount())}</span></div>` : ''}</div>
    <div class="customer-checkout-total"><span>${t('total')}</span><strong>${money(subtotal() - discount())}</strong></div>${errorMessage()}<button class="customer-primary customer-submit" data-action="submit-order" type="button" ${busy || !count() || paused() ? 'disabled' : ''}>${busy ? `<span class="customer-spinner"></span> ${t('sending')}` : `${t('submit')} ${icon('arrow-right', 18)}`}</button><p class="customer-small-note">${t('payNote')}</p></form></main>`;
}

function renderReceipt() {
  const order = viewedOrder();
  if (!order) return `${pageHeader(t('myOrder'), 'menu')}<main class="customer-page customer-empty"><h1>${t('orderMissing')}</h1><p>${t('orderMissingText')}</p><button class="customer-primary" data-action="new-order">${t('reorder')}</button></main>`;
  const statuses = ['new', 'accepted', 'preparing', 'ready', 'completed'];
  const cancelled = order.status === 'cancelled';
  const finished = FINISHED.includes(order.status);
  const current = Math.max(0, statuses.indexOf(order.status));
  const detail = t('statuses')[order.status] || t('statuses').new;
  const labels = t('progress');
  const others = myOrders().filter(row => row.id !== order.id && !FINISHED.includes(row.status));
  const switcher = others.length ? `<div class="customer-order-switch"><span>${t('yourOrders')}</span>${[order, ...others].map(row => `<button data-action="view-order" data-id="${esc(row.id)}" class="${row.id === order.id ? 'is-active' : ''}" aria-pressed="${row.id === order.id}">${esc(shortNumber(row.number))}<small>${esc(t('statusShort')[row.status] || '')}</small></button>`).join('')}</div>` : '';
  const queueLine = QUEUE.includes(order.status) ? `<p class="customer-ahead">${icon('clock', 14)} ${esc(t('ahead', Number(order.ahead || 0)))}</p>` : '';
  const cancelInfo = cancelled ? `<div class="customer-cancel-info">${order.cancelReason ? `<p>${esc(t('cancelReason', order.cancelReason))}</p>` : ''}${order.discount ? `<p>${esc(t('couponReturned', order.discount.code))}</p>` : ''}</div>` : '';
  return `${pageHeader(t('myOrder'), 'menu')}<main class="customer-page customer-receipt ${cancelled ? 'is-cancelled' : ''}">${switcher}<div class="customer-receipt-icon ${order.status === 'ready' ? 'is-ready' : ''} ${cancelled ? 'is-cancelled' : ''}">${icon(order.status === 'ready' ? 'bell' : cancelled ? 'ban' : 'check', 32)}</div><p class="customer-eyebrow">ORDER STATUS</p><h1>${detail[0]}</h1><p class="customer-muted">${detail[1]}</p>${queueLine}${cancelInfo}<section class="customer-ticket"><div class="customer-ticket-top"><span>${t('pickupNumber')}</span><strong>${esc(shortNumber(order.number || order.id))}</strong><small>${esc(order.customer?.name || form.name || '')} · ${esc(t('fullNumber', order.number || order.id))}</small></div><div class="customer-ticket-perforation"></div>${cancelled ? '' : `<div class="customer-order-progress" aria-label="progress">${statuses.map((status, index) => `<div class="${index <= current ? 'is-done' : ''} ${index === current ? 'is-current' : ''}"><span>${index < current ? icon('check', 11) : index + 1}</span><small>${labels[index]}</small></div>`).join('')}</div>`}<div class="customer-ticket-items">${(order.items || []).map(item => { const source = menu().find(entry => entry.id === item.menuId); return `<div><span>${Number(item.quantity || 1)} × ${esc((lang === 'en' && source?.nameEn) || item.name || '')}</span><strong>${money(Number(item.price ?? source?.price ?? 0) * Number(item.quantity || 1))}</strong></div>`; }).join('')}${order.discount ? `<div class="customer-ticket-discount"><span>${t('discount')}（${esc(order.discount.code)}）</span><strong>−${money(order.discount.amount)}</strong></div>` : ''}${order.note ? `<p class="customer-receipt-note">${t('note')}：${esc(order.note)}</p>` : ''}</div><div class="customer-ticket-total"><span>${t('total')}</span><strong>${money(Number(order.total || 0))}</strong></div></section>${QUEUE.includes(order.status) ? `<p class="customer-keep-open">${icon('bell', 14)} ${t('keepOpen')}</p>` : ''}${finished ? '' : `<p class="customer-live-status"><span></span> ${t('live')}</p>`}<button class="${finished ? 'customer-primary' : 'customer-secondary'}" data-action="new-order">${icon('plus', 18)} ${t('again')}</button></main>`;
}

function renderCenter() {
  const me = member();
  if (!me) { phase = 'entry'; return renderEntry(); }
  const offers = state?.offers || [];
  const inbox = state?.inbox || [];
  const reward = profileReward();
  return `${pageHeader(t('center'))}<main class="customer-page customer-center">${noticeBox()}<div class="customer-center-card"><span class="customer-center-avatar">${esc(me.name.slice(0, 1))}</span><div><h1>${esc(me.name)}</h1><p>${esc(me.phone)}</p></div></div>
    <section class="customer-center-section"><h2>${icon('tag', 17)} ${t('offers')}</h2>${offers.length ? offers.map(offer => `<div class="customer-offer-card"><div><strong>${esc(offer.label)}</strong><small>${esc(offerMeta(offer))}</small><code>${esc(offer.code)}</code></div><button data-action="use-offer" data-id="${esc(offer.code)}">${t('use')}</button></div>`).join('') : `<p class="customer-muted">${t('offersEmpty')}</p>`}</section>
    ${me.profileComplete && !profileEditing
      ? `<section class="customer-center-section"><h2>${icon('user', 17)} ${t('myProfile')}<button type="button" class="customer-edit-link" data-action="profile-edit">${icon('pen', 13)} ${t('editProfile')}</button></h2>${profileSummary(me)}</section>`
      : me.profileComplete
        ? `<section class="customer-center-section customer-profile-edit"><h2>${icon('user', 17)} ${t('editTitle')}</h2><form class="customer-form" data-form="profile" novalidate><label>${t('name')} <span>*</span><input name="editName" data-field="editName" autocomplete="given-name" maxlength="30" value="${esc(form.editName)}" required></label><p class="customer-field-note">${icon('lock', 12)} ${esc(me.phone)} · ${t('phoneLocked')}</p>${profileFields({ consented: consented() })}${errorMessage()}<button class="customer-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? t('saving') : t('saveChanges')}</button><button type="button" class="customer-guest-button" data-action="profile-cancel">${t('cancelEdit')}</button></form></section>`
        : `<section class="customer-center-section"><details class="customer-profile" open><summary><span class="customer-profile-gift">${icon('gift', 18)}</span><span><strong>${esc(t('profileTitle', reward))}</strong><small>${t('profileNote')}</small></span>${icon('arrow-right', 16)}</summary><form class="customer-form" data-form="profile" novalidate>${profileFields({ consented: consented() })}${errorMessage()}<button class="customer-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? t('saving') : t('saveProfile')}</button></form></details></section>`}
    <section class="customer-center-section"><h2>${icon('send', 17)} ${t('inbox')}</h2>${inbox.length ? inbox.map(message => `<article class="customer-message ${String(message.sentAt) > centerSeenBefore ? 'is-new' : ''}"><div><strong>${String(message.sentAt) > centerSeenBefore ? `<span class="customer-new">${t('newMessage')}</span>` : ''}${esc(message.title)}</strong><small>${esc(dateText(message.sentAt))}</small></div><p>${esc(message.message)}</p></article>`).join('') : `<p class="customer-muted">${t('inboxEmpty')}</p>`}</section>
    <button class="customer-primary" data-action="menu">${t('continueOrder')} ${icon('arrow-right', 18)}</button><button class="customer-guest-button" data-action="sign-out">${t('signOut')}</button></main>`;
}

function renderReward() {
  if (!reward) { phase = 'menu'; return renderMenu(); }
  return `${pageHeader(t('center'), 'menu')}<main class="customer-page customer-reward"><div class="customer-reward-icon">${icon('gift', 36)}</div><h1>${t('rewardTitle')}</h1><p class="customer-muted">${t('rewardText')}</p><div class="customer-reward-code"><span>${esc(reward.label)}</span><strong>${esc(reward.code)}</strong>${reward.expiresAt ? `<small>${esc(t('until', dateText(reward.expiresAt)))}</small>` : ''}<button data-action="copy-code" data-id="${esc(reward.code)}">${copied ? t('copied') : t('copy')}</button></div><button class="customer-primary" data-action="use-offer" data-id="${esc(reward.code)}">${t('startOrder')} ${icon('arrow-right', 18)}</button></main>`;
}

function renderMissing() {
  return `<div class="customer-device customer-loading"><span class="customer-brand-symbol">${icon('truck', 30)}</span><h1>${t('notFound')}</h1><p>${t('notFoundText')}</p>${langButton()}</div>`;
}

const PHASES = { entry: renderEntry, member: renderMember, checkout: renderCheckout, receipt: renderReceipt, center: renderCenter, reward: renderReward, menu: renderMenu };
function render() {
  if (!app) return;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
  if (notFound) { document.title = t('notFound'); app.innerHTML = renderMissing(); return; }
  if (!state) return;
  document.title = `${brandName()}｜${t('orderOnline')}`;
  const active = document.activeElement;
  const field = active?.dataset?.field || active?.dataset?.profile;
  const position = active?.selectionStart;
  renderedSignature = viewSignature(state);
  app.innerHTML = `<div class="customer-device">${(PHASES[phase] || renderMenu)()}</div>`;
  if (field) {
    const next = app.querySelector(`[data-profile="${field}"]:checked`) || app.querySelector(`[data-field="${field}"],[data-profile="${field}"]`);
    next?.focus({ preventScroll: true });
    if (typeof position === 'number' && !['tel', 'number'].includes(next?.type)) { try { next.setSelectionRange(position, position); } catch { /* Inputs without selections remain focused. */ } }
  }
}

function go(next) { error = ''; couponError = ''; notice = ''; drawer = false; if (next !== 'member') needCode = false; phase = next; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
const validPhone = value => /^09\d{8}$/.test(value.replace(/[\s()-]/g, '').replace(/^\+886/, '0'));

function validateProfile(requireComplete) {
  if (!profileTouched()) return requireComplete ? t('profileMissing', missingLabels()) : '';
  if (!consent && !consented()) return t('consentRequired');
  if (requireComplete && !profileReady()) return t('profileMissing', missingLabels());
  return '';
}
async function saveMember() {
  if (busy) return;
  if (!form.name.trim()) { error = t('nameRequired'); render(); return; }
  if (!form.phone.trim()) { error = t('phoneRequired'); render(); return; }
  if (!validPhone(form.phone)) { error = t('phoneInvalid'); render(); return; }
  const problem = needCode ? '' : validateProfile(false);
  if (problem) { error = problem; render(); return; }
  if (needCode && !/^\d{6}$/.test(form.loginCode.trim())) { error = t('codeHelp'); render(); return; }
  busy = true; error = ''; render();
  let joined = false;
  try {
    const response = await dispatch('member.join', { name: form.name.trim(), phone: form.phone.trim(), optIn, ...(ownMemberId ? { memberId: ownMemberId } : {}), ...(needCode ? { loginCode: form.loginCode.trim() } : profileTouched() ? { consent, demographics: profilePayload() } : {}) });
    state = response.state || getState();
    if (response.result?.error) { error = response.result.error; return; }
    const saved = response.result?.member;
    if (!saved?.id) throw new Error(t('loadError'));
    ownMemberId = saved.id; save(keys.member, ownMemberId); setSubscription({ member: ownMemberId });
    reward = response.result?.reward || null;
    needCode = false; form.loginCode = '';
    phase = reward ? 'reward' : 'menu';
    joined = true;
    if (!reward) {
      const invite = !saved.profileComplete && profileReward() ? ` <button type="button" class="customer-link" data-action="member-center">${esc(t('welcomeProfile', profileReward()))}</button>` : '';
      notice = `${esc(t('welcomeJoined', saved.name))}${invite}`;
    }
  } catch (failure) {
    // The phone already belongs to a member: ask for the one-time code the truck hands over.
    // The code box explains the step, so its first appearance needs no extra error message.
    if (failure.status === 409 && !needCode) { needCode = true; form.loginCode = ''; error = ''; }
    else error = failure.message;
  } finally {
    busy = false; render();
    if (joined) window.scrollTo({ top: 0 });
  }
}
async function saveProfile() {
  if (busy) return;
  const editing = profileEditing;
  if (editing && !form.editName.trim()) { error = t('nameRequired'); render(); return; }
  const problem = validateProfile(true);
  if (problem) { error = problem; render(); return; }
  busy = true; error = ''; render();
  try {
    const response = await dispatch('member.profile', { memberId: ownMemberId, consent: consent || consented(), demographics: profilePayload(), ...(editing ? { name: form.editName.trim() } : {}) });
    state = response.state || getState();
    reward = response.result?.reward || null;
    if (reward) phase = 'reward';
    if (editing) { profileEditing = false; notice = esc(t('profileSaved')); }
  } catch (failure) { error = failure.message; }
  finally { busy = false; render(); if (phase === 'reward' || editing) window.scrollTo({ top: 0 }); }
}

const itemsPayload = () => cartLines().map(item => ({ menuId: item.id, quantity: item.quantity }));
async function checkCoupon(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) { couponError = lang === 'en' ? 'Please enter a code.' : '請輸入折扣碼。'; render(); return; }
  couponError = '';
  const result = await publicCheck('coupon.check', { code: value, items: itemsPayload(), ...(member() ? { memberId: member().id } : { phone: form.phone.trim() }) }).catch(failure => ({ ok: false, error: failure.message }));
  if (result?.ok) { applied = { code: result.code, amount: result.amount, label: result.label, minSpend: Number(result.minSpend || 0) }; form.coupon = ''; }
  else { applied = null; couponError = result?.error || (lang === 'en' ? 'This code cannot be used.' : '折扣碼無法使用。'); }
  render();
}
/** Cart edits can invalidate an applied code (minimum spend, buy-one-get-one): check it again. */
function recheckCoupon() {
  if (!applied) return;
  const code = applied.code;
  if (!count()) { applied = null; return; }
  checkCoupon(code);
}

async function submitOrder() {
  if (busy) return;
  const me = member();
  if (!form.name.trim()) { error = t('nameRequired'); render(); return; }
  if (!me && !form.phone.trim()) { error = t('phoneRequired'); render(); return; }
  if (!me && !validPhone(form.phone)) { error = t('phoneInvalid'); render(); return; }
  if (!count()) { error = t('pickItem'); render(); return; }
  if (paused()) { error = state.ordering.message || t('pausedText'); render(); return; }
  // This tap lets the receipt chime when the order is ready.
  sound.unlock();
  busy = true; error = ''; render();
  try {
    const response = await dispatch('order.create', {
      customer: { name: form.name.trim(), ...(me ? {} : { phone: form.phone.trim() }) },
      items: itemsPayload(), note: form.note.trim(), ...(me ? { memberId: me.id } : {}), ...(applied ? { couponCode: applied.code } : {}),
    });
    state = response.state || getState();
    const created = response.result?.order;
    if (!created?.id) throw new Error(lang === 'en' ? 'We could not confirm your order. Please check with the truck before ordering again.' : '尚未取得訂單確認。請先向餐車確認是否收到，再重新操作。');
    ownOrderIds = [created.id, ...ownOrderIds.filter(id => id !== created.id)].slice(0, 5); saveOrders();
    viewOrderId = created.id; lastStatus.set(created.id, created.status);
    followOrders();
    cart.clear(); form.note = ''; applied = null; notice = ''; phase = 'receipt'; drawer = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (failure) {
    error = failure.message;
    if (applied && /折扣碼|code/i.test(failure.message)) applied = null;
  } finally { busy = false; render(); }
}

app?.addEventListener('input', event => {
  const target = event.target;
  const field = target?.dataset?.field;
  if (field && Object.hasOwn(form, field)) form[field] = target.value;
  const key = target?.dataset?.profile;
  if (key && Object.hasOwn(profile, key)) profile[key] = target.value;
  // A message about a field the customer is now fixing goes away instead of lingering until the next submit.
  if (field === 'coupon' && couponError) { couponError = ''; app.querySelector('.customer-error[data-kind="coupon"]')?.remove(); }
  else if ((field || key) && error) { error = ''; app.querySelector('.customer-error[data-kind="general"]')?.remove(); }
});
app?.addEventListener('change', event => {
  const target = event.target;
  const key = target.dataset.profile;
  if (key) profile[key] = target.value;
  // A new city offers a different district list; the earlier district no longer applies.
  if (key === 'city' && !(TW_DISTRICTS[profile.city] || []).includes(profile.district)) profile.district = '';
  if (target.dataset.diet) {
    const value = target.dataset.diet;
    profile.diet = target.checked ? [...new Set([...profile.diet, value])] : profile.diet.filter(item => item !== value);
  }
  if (target.dataset.flag === 'consent') consent = target.checked;
  if (target.dataset.flag === 'optIn') optIn = target.checked;
  // Redraw so the district list and the required-answers meter follow the choice.
  if (key && !busy) render();
});
app?.addEventListener('submit', event => {
  event.preventDefault();
  const kind = event.target.dataset.form;
  if (kind === 'member') return saveMember();
  if (kind === 'profile') return saveProfile();
  return submitOrder();
});
app?.addEventListener('keydown', event => {
  if (event.key === 'Escape' && drawer && !busy) { drawer = false; render(); }
  if (event.key === 'Enter' && event.target?.dataset?.field === 'coupon') { event.preventDefault(); checkCoupon(form.coupon); }
});
app?.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  if (action === 'retry') return start();
  if (action === 'lang') { lang = lang === 'en' ? 'zh' : 'en'; save(keys.lang, lang); render(); return; }
  if (busy) return;
  if (action === 'member-entry') return go('member');
  // Members see 「繼續點餐」 instead, so ordering as a guest never signs a member out silently.
  if (action === 'guest') { if (!member()) { form.name = ''; form.phone = ''; } return go('menu'); }
  // Existing phone without a code yet: order as a guest with the same name and phone (the order still counts for the member).
  if (action === 'guest-with-phone') { needCode = false; form.loginCode = ''; return go('menu'); }
  if (action === 'sign-out') {
    ownMemberId = null; save(keys.member, null); setSubscription({ member: null }); applied = null; form.name = ''; form.phone = ''; form.editName = '';
    // A shared phone must not show the previous member's answers to the next person.
    for (const key of Object.keys(profile)) profile[key] = key === 'diet' ? [] : '';
    consent = false; profileEditing = false;
    return go('entry');
  }
  if (action === 'dismiss-notice') { notice = ''; render(); return; }
  if (action === 'view-order') { viewOrderId = id; return go('receipt'); }
  if (action === 'member-center') { markInboxSeen(); profileEditing = false; loadProfile(); return go('center'); }
  if (action === 'profile-edit') { loadProfile(); form.editName = member()?.name || ''; profileEditing = true; error = ''; render(); app.querySelector('.customer-profile-edit')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  if (action === 'profile-cancel') { profileEditing = false; error = ''; loadProfile(); render(); return; }
  if (action === 'entry' || action === 'menu') return go(action);
  if (action === 'category') { category = id; render(); return; }
  if (action === 'add' || action === 'remove') {
    const item = menu().find(entry => entry.id === id);
    if (!item || item.soldOut) return;
    const next = Math.max(0, Math.min(99, (cart.get(id) || 0) + (action === 'add' ? 1 : -1)));
    next ? cart.set(id, next) : cart.delete(id);
    render(); recheckCoupon(); return;
  }
  if (action === 'cart' || action === 'close-cart') { drawer = action === 'cart'; render(); return; }
  if (action === 'checkout') {
    if (member() && !form.name) form.name = member().name;
    go('checkout');
    if (form.coupon && !applied) checkCoupon(form.coupon);
    return;
  }
  if (action === 'edit-cart') { phase = 'menu'; drawer = true; render(); return; }
  if (action === 'apply-coupon') return checkCoupon(form.coupon);
  if (action === 'remove-coupon') { applied = null; couponError = ''; render(); return; }
  if (action === 'use-offer') {
    form.coupon = id;
    if (phase === 'checkout') return checkCoupon(id);
    if (count()) { go('checkout'); return checkCoupon(id); }
    // No items yet: the code waits in the coupon field and is applied when the customer reaches checkout.
    return go('menu');
  }
  if (action === 'copy-code') {
    try { await navigator.clipboard.writeText(id); copied = true; } catch { copied = false; }
    render(); return;
  }
  if (action === 'submit-order') return submitOrder();
  if (action === 'new-order') {
    // Ordering again keeps following unfinished orders; a finished one is let go.
    const viewed = viewedOrder();
    if (!viewed || FINISHED.includes(viewed.status)) { ownOrderIds = ownOrderIds.filter(orderId => orderId !== viewOrderId); saveOrders(); followOrders(); }
    viewOrderId = activeOrders()[0]?.id || null;
    cart.clear(); return go('menu');
  }
});
// Browsers play sound only after a tap: any tap on the page enables the "ready" chime.
app?.addEventListener('pointerdown', () => sound.unlock(), { passive: true });
async function start() {
  if (!app) return;
  app.innerHTML = `<div class="customer-device customer-loading"><span class="customer-spinner"></span><p>${t('loading')}</p></div>`;
  try {
    // Realtime updates arrive over WebSocket; polling (receipt 5s, menu 30s) is only a fallback.
    state = await init({ view: 'public', truck, order: ownOrderIds.join(',') || null, member: ownMemberId, pollMs: ownOrderIds.length ? 5000 : 30000 });
    if (!state) state = getState();
    if (!state) throw new Error(t('loadError'));
    if (member()) { form.name = member().name || ''; }
    // Forget orders that are gone or finished a while ago; reopen the newest unfinished one.
    const known = myOrders();
    ownOrderIds = ownOrderIds.filter(id => { const order = known.find(row => row.id === id); return order && (!FINISHED.includes(order.status) || recentlyChanged(order)); });
    saveOrders(); followOrders();
    for (const order of myOrders()) lastStatus.set(order.id, order.status);
    const active = [...activeOrders()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    viewOrderId = active[0]?.id || null;
    phase = active.length ? 'receipt' : member() ? 'menu' : 'entry';
    render();
  } catch (failure) {
    if (failure.status === 404) { notFound = true; render(); return; }
    app.innerHTML = `<div class="customer-device customer-loading"><span class="customer-brand-symbol">${icon('truck', 30)}</span><h1>${t('loadError')}</h1><p>${esc(failure.message || '')}</p><button class="customer-primary" data-action="retry">${t('retry')} ${icon('arrow-right', 18)}</button></div>`;
  }
}

// Re-render only when something this page shows actually changed.
const viewSignature = view => JSON.stringify([view?.brand, view?.menu, view?.stalls, view?.order, view?.myOrders, view?.member, view?.offers, view?.inbox, view?.ordering]);
let renderedSignature = '';
/** Items that sold out (or were taken off the menu) while in the cart are removed, with a note, and the code is checked again. */
function reconcileCart(before) {
  const names = [];
  for (const id of [...cart.keys()]) {
    const item = menu().find(entry => entry.id === id);
    if (item && !item.soldOut) continue;
    names.push(itemName(item || (before?.menu || []).find(entry => entry.id === id)));
    cart.delete(id);
  }
  if (!names.length) return false;
  notice = esc(t('soldOutRemoved', names.filter(Boolean).join('、')));
  if (!count()) { applied = null; drawer = false; if (phase === 'checkout') phase = 'menu'; }
  else recheckCoupon();
  return true;
}
const lastStatus = new Map();
let flashTimer = null;
function alertCustomer(order, ready) {
  try { navigator.vibrate?.(ready ? [400, 150, 400, 150, 800] : [300]); } catch { /* not supported */ }
  sound.chime(ready ? 3 : 1);
  if (!ready) return;
  clearInterval(flashTimer);
  let on = false;
  let ticks = 0;
  flashTimer = setInterval(() => {
    on = !on; ticks++;
    document.title = on ? `${t('readyFlash')} ${shortNumber(order.number)}` : `${brandName()}｜${t('orderOnline')}`;
    if (ticks > 180 || (document.visibilityState === 'visible' && ticks > 8)) { clearInterval(flashTimer); document.title = `${brandName()}｜${t('orderOnline')}`; }
  }, 1000);
}
/** Ready or cancelled orders buzz, chime and come to the front (unless the customer is mid-form). */
function detectStatusChanges() {
  let changed = false;
  let surfaced = false;
  for (const order of myOrders()) {
    const previous = lastStatus.get(order.id);
    lastStatus.set(order.id, order.status);
    if (!previous || previous === order.status) continue;
    changed = true;
    if (order.status !== 'ready' && order.status !== 'cancelled') continue;
    alertCustomer(order, order.status === 'ready');
    if (phase !== 'checkout' && phase !== 'member') { viewOrderId = order.id; drawer = false; phase = 'receipt'; surfaced = true; }
  }
  if (changed) followOrders();
  return { changed, surfaced };
}
subscribe(() => {
  if (!state) return;
  const before = state;
  state = getState();
  const removed = reconcileCart(before);
  const { changed, surfaced } = detectStatusChanges();
  if (!removed && !changed && viewSignature(state) === renderedSignature) return;
  render();
  if (surfaced) window.scrollTo({ top: 0, behavior: 'smooth' });
});
// Broken menu photos fall back to the illustrated placeholder (no inline handlers, so a strict CSP stays possible).
app?.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.hasAttribute('data-fallback')) return;
  image.hidden = true;
  image.parentElement?.classList.add('customer-image-unavailable');
}, true);
start();
