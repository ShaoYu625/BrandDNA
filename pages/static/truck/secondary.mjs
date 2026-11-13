import { metaAnalytics, metaSettings, metaStatusLabel } from './merchant-meta.mjs';
import { assetKit } from './merchant-assets.mjs';
import { ui, orderUrl, store } from './merchant-ui.mjs';
import { labelFor } from './merchant-labels.mjs';

const ORDER_LABELS = { new: '新訂單', accepted: '已接單', preparing: '製作中', ready: '可取餐', completed: '已完成', cancelled: '已取消' };
/** The next step of each status. A new order is accepted and started in one tap. */
const ORDER_NEXT = { new: ['preparing', '接單並開始製作'], accepted: ['preparing', '開始製作'], preparing: ['ready', '通知可取餐'], ready: ['completed', '完成取餐'] };
/** Undo of the last tap (a new order went straight to 製作中, so undoing that returns it to 新訂單). */
const ORDER_BACK = { accepted: 'new', preparing: 'new', ready: 'preparing', completed: 'ready' };
export const CANCEL_REASONS = ['顧客沒有來取餐', '餐點售完', '顧客要求取消', '重複下單', '其他'];
/** Pickup number customers hear at the truck: the daily sequence (H1111-004 → 004). */
export const shortOrderNumber = number => { const value = String(number || ''); return value.includes('-') ? value.split('-').pop() : value; };

function taipeiDate(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
let displayMonth = taipeiDate().slice(0, 7);
/** A scheduled post without Meta is only a reminder: once its time has passed it still needs to be posted by hand. */
export const isOverdue = (post, now = Date.now()) => post.status === 'scheduled' && !post.meta && Date.parse(post.scheduledAt || '') <= now;

export function shiftCalendar(direction) {
  if (direction === 'today' || direction === 0) { displayMonth = taipeiDate().slice(0, 7); return; }
  const amount = direction === 'prev' ? -1 : direction === 'next' ? 1 : Number(direction);
  if (!Number.isFinite(amount)) return;
  const [year, month] = displayMonth.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1));
  displayMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

function tools(context) {
  const { icon, esc, money, dateLabel } = context;
  const when = value => {
    if (!value) return '尚未記錄';
    if (typeof dateLabel === 'function') { try { return esc(dateLabel(value)); } catch { /* Fall back to a validated date below. */ } }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '日期未設定' : esc(date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }));
  };
  return { icon, esc, money, when, dateLabel };
}

function orderBadge(status, esc) {
  const style = { new: 'draft', accepted: 'approved', preparing: 'scheduled', ready: 'approved', completed: 'neutral', cancelled: 'cancelled' }[status] || 'neutral';
  return `<span class="badge ${style}">${esc(ORDER_LABELS[status] || status || '未設定')}</span>`;
}
function empty(icon, title, detail, action = '') { return `<div class="empty">${icon}<h3>${title}</h3><p>${detail}</p>${action}</div>`; }
function stat(icon, label, value, note) { return `<article class="stat"><span class="stat-icon">${icon}</span><div class="stat-label">${label}</div><div class="stat-number">${value}</div><div class="stat-note">${note}</div></article>`; }

function calendar(state, context) {
  const { icon, esc } = tools(context);
  const [year, month] = displayMonth.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const today = taipeiDate();
  const stalls = (state.stalls || []).map(stall => ({ id: stall.id, date: stall.date, time: stall.start || '', title: stall.title || '出攤', detail: stall.location || '地點待設定', type: 'stall', item: stall }));
  const posts = (state.posts || []).filter(post => (post.status === 'scheduled' && post.scheduledAt) || (post.status === 'published' && post.publishedAt)).map(post => {
    const timestamp = post.status === 'scheduled' ? post.scheduledAt : post.publishedAt;
    const date = new Date(timestamp);
    const overdue = isOverdue(post);
    return { id: post.id, date: taipeiDate(timestamp), time: Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }), title: post.title || post.topic || '社群貼文', detail: `${post.platform === 'facebook' ? 'FB' : 'IG'} · ${post.meta ? metaStatusLabel(post) : post.status === 'published' ? '已發布' : overdue ? '時間已過，尚未發布' : '已排程'}`, type: 'post', overdue, item: post };
  });
  // Each event carries its colour label (custom, or the default 出攤／貼文).
  const events = [...stalls, ...posts].map(event => ({ ...event, label: labelFor(state, event.item.label, event.type) })).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const custom = state.settings?.calendarLabels || [];
  const legend = `<div class="calendar-legend"><span class="legend-stall">餐車出攤</span><span class="legend-post">社群貼文</span>${custom.map(label => `<button type="button" class="legend-lbl lbl-${esc(label.color)}" data-action="label-edit" data-id="${esc(label.id)}" title="編輯「${esc(label.name)}」標籤">${esc(label.name)}</button>`).join('')}<button type="button" class="legend-add" data-action="label-edit" title="新增顏色標籤">${icon('plus', 11)} 標籤</button></div>`;
  const monthEvents = events.filter(event => event.date?.startsWith(displayMonth));
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayEvents = events.filter(event => event.date === key);
    const label = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    return `<div class="calendar-cell ${date.getUTCMonth() !== month - 1 ? 'other' : ''} ${key === today ? 'today' : ''}"><span class="day-number" ${key === today ? 'aria-label="今天"' : ''}>${date.getUTCDate()}</span>${key >= today ? `<button class="calendar-add" data-action="stall-new" data-date="${key}" aria-label="安排 ${label} 出攤" title="安排 ${label} 出攤">${icon('plus', 12)}</button>` : ''}${dayEvents.map(event => `<button class="calendar-event ${event.type} lbl-${esc(event.label.color)} ${event.label.id === event.type ? '' : 'custom'} ${event.overdue ? 'overdue' : ''}" data-action="${event.type === 'post' ? 'post-edit' : 'stall-edit'}" data-id="${esc(event.id)}" title="${esc(`${event.label.name}｜${event.time} ${event.title}｜${event.detail}`)}">${esc(event.time)} ${event.type === 'post' ? (event.item.platform === 'facebook' ? 'FB' : 'IG') : '出攤'} · ${esc(event.title)}</button>`).join('')}</div>`;
  }).join('');
  return `<div class="notice sea">${icon('calendar', 17)}<span>點月曆上的項目查看或編輯，點日期旁的「＋」直接在那天新增出攤。排程貼文或新增出攤時可以選顏色標籤，也能按「自訂」建立自己的類型；圖例上的標籤點一下可以改名、換色或刪除。連結 Meta 的排程會在指定時間自動發布；沒有連結時，時間到了請手動貼文再按「標記為已發布」。出攤前兩天還沒有預告貼文，鈴鐺會提醒你。</span></div><div class="grid cols-main"><section class="panel"><div class="calendar-bar"><div class="actions"><h2>${year} 年 ${month} 月</h2><button class="btn small" data-action="calendar-prev" aria-label="上一個月">${icon('arrow-left', 14)}</button><button class="btn small" data-action="calendar-next" aria-label="下一個月">${icon('arrow-right', 14)}</button><button class="btn small soft" data-action="calendar-today">今天</button></div>${legend}</div><div class="calendar-container"><div class="calendar-grid">${['日', '一', '二', '三', '四', '五', '六'].map(day => `<div class="calendar-week">週${day}</div>`).join('')}${cells}</div></div><p class="fine muted" style="margin-top:12px;text-align:right">台北時間</p></section><aside class="grid" style="align-content:start"><section class="panel"><div class="panel-head"><h2>本月安排</h2><span class="badge neutral">${monthEvents.length} 筆</span></div>${monthEvents.length ? monthEvents.map(event => `<div class="row-item"><div class="row-icon ${event.type}">${icon(event.type === 'post' ? 'pen' : 'truck', 17)}</div><div class="row-main"><strong>${esc(event.title)}</strong><p><span class="label-pill lbl-${esc(event.label.color)}">${esc(event.label.name)}</span>${esc(event.date.slice(5))} ${esc(event.time)} · ${esc(event.detail)}</p></div><button class="text-link" data-action="${event.type === 'post' ? 'post-edit' : 'stall-edit'}" data-id="${esc(event.id)}" aria-label="編輯 ${esc(event.title)}">${icon('arrow-right', 15)}</button></div>`).join('') : empty(icon('calendar', 28), '這個月還沒有安排', '按右上角「新增出攤」，或到貼文工作區排程貼文。', '<a class="btn small" href="/generate">前往貼文工作區</a>')}</section><section class="panel" style="background:#f5f1e3"><p class="eyebrow" style="color:#a39c7a;font-size:8px">TIP</p><h3 style="margin:10px 0 8px">出車前記得發預告</h3><p class="body-copy">建議前一天發，寫清楚日期、時間、地點，還有能不能先線上預訂。</p><button class="text-link" data-action="post-new" data-topic="本週出車預告：時間、地點與預訂方式" data-key="stall" style="margin-top:14px">寫出車預告 ${icon('arrow-right', 13)}</button></section></aside></div>`;
}

function minutesSince(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 60000)) : 0;
}
function orders(state, context) {
  const { icon, esc, money, when } = tools(context);
  const today = taipeiDate();
  // Kitchen queue: oldest first.
  const all = [...(state.orders || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const columns = [
    ['new', '新訂單', all.filter(order => order.status === 'new'), '顧客送單後會即時出現在這裡。'],
    ['cooking', '製作中', all.filter(order => order.status === 'accepted' || order.status === 'preparing'), '接單後的訂單在這裡製作。'],
    ['ready', '待取餐', all.filter(order => order.status === 'ready'), '通知可取餐後，顧客手機會震動提醒。'],
  ];
  const queue = all.filter(order => ['new', 'accepted', 'preparing'].includes(order.status));
  const prep = new Map();
  for (const order of queue) for (const item of order.items || []) prep.set(item.name, (prep.get(item.name) || 0) + Number(item.quantity || 1));
  const ordering = state.settings?.ordering || {};
  const soundOn = store('orders.sound', true);
  const todays = all.filter(order => taipeiDate(order.createdAt) === today);
  const finished = [...all].filter(order => order.status === 'completed' || order.status === 'cancelled').reverse().slice(0, 12);
  const revenue = todays.filter(order => order.status === 'completed').reduce((sum, order) => sum + Number(order.total || 0), 0);

  const card = order => {
    const [next, label] = ORDER_NEXT[order.status] || [];
    const back = ORDER_BACK[order.status];
    const old = taipeiDate(order.createdAt) !== today;
    const waited = minutesSince(order.status === 'ready' ? order.updatedAt || order.createdAt : order.createdAt);
    const late = !old && order.status !== 'ready' && waited >= 20;
    const span = waited < 60 ? `${waited} 分` : `${Math.floor(waited / 60)} 小時${waited % 60 ? ` ${waited % 60} 分` : ''}`;
    const wait = old ? `${esc(when(order.createdAt))} 的訂單` : order.status === 'ready' ? `已等取餐 ${span}` : `等候 ${span}`;
    return `<article class="order-card ${late ? 'late' : ''} ${old ? 'stale' : ''}" data-order="${esc(order.id)}">
      <div class="order-card-top"><span class="order-no" title="取餐號碼">${esc(shortOrderNumber(order.number || order.id))}</span><span class="order-meta"><span>#${esc(order.number || order.id)}</span>${orderBadge(order.status, esc)}</span><span class="order-wait">${icon('clock', 12)} ${wait}</span></div>
      <p class="order-customer"><strong>${esc(order.customer?.name || '現場顧客')}</strong> <span class="muted">· ${esc(order.customer?.phone || '未提供手機')} · ${order.memberId ? '會員' : '訪客'}</span></p>
      <ul class="order-items">${(order.items || []).map(item => `<li><b>${Number(item.quantity || 1)}</b>${esc(item.name || '餐點')}</li>`).join('')}</ul>
      ${order.note ? `<p class="order-note">${icon('info', 12)} ${esc(order.note)}</p>` : ''}
      ${order.discount ? `<p class="order-discount">${icon('tag', 12)} 折扣碼 <code>${esc(order.discount.code)}</code> ${esc(order.discount.label)} −${money(order.discount.amount)}</p>` : ''}
      <div class="order-card-foot"><div><strong class="order-total">${money(Number(order.total || 0))}</strong>${order.discount ? ` <s class="fine muted">${money(order.subtotal)}</s>` : ''}</div>
        <div class="order-actions">${back ? `<button class="text-link" data-action="order-back" data-id="${esc(order.id)}" data-status="${back}" title="按錯了？退回上一步">退回</button>` : ''}<button class="text-link danger-link" data-action="order-cancel" data-id="${esc(order.id)}">取消</button>${next ? `<button class="btn primary small" data-action="order-next" data-id="${esc(order.id)}" data-status="${next}">${esc(label)} ${icon('arrow-right', 12)}</button>` : ''}</div></div>
    </article>`;
  };
  // Column titles render twice: in the frozen row above the board (wide screens) and atop each column (stacked on phones).
  // CSS shows exactly one of them, so the hidden copy never reaches assistive technology.
  const head = ([key, title, rows]) => `<div class="order-column-head ${key}"><h2>${title} <span class="badge ${key === 'new' && rows.length ? 'draft' : 'neutral'}">${rows.length}</span></h2>${key === 'ready' && rows.length ? `<button class="btn small" data-action="orders-complete-ready">${icon('check', 12)} 全部完成取餐</button>` : ''}</div>`;
  const column = ([key, title, rows, hint]) => `<section class="order-column ${key}" aria-label="${title}">${head([key, title, rows])}${rows.map(card).join('') || `<p class="order-column-empty">${hint}</p>`}</section>`;

  const control = `<section class="ordering-bar ${ordering.paused ? 'paused' : ''}"><span class="ordering-dot" aria-hidden="true"></span><div class="ordering-copy"><strong>${ordering.paused ? '已暫停線上接單' : '線上接單中'}</strong><small>${ordering.paused ? esc(ordering.message || '顧客點餐頁會顯示暫停中，無法送出新訂單。') : '顧客掃碼就能點餐，新訂單會響提示音。'}</small></div><div class="actions"><button class="btn small" data-action="order-sound" aria-pressed="${soundOn}">${icon('bell', 13)} 提示音：${soundOn ? '開' : '關'}</button><button class="btn small ${ordering.paused ? 'primary' : 'danger'}" data-action="ordering-toggle">${ordering.paused ? '恢復接單' : '暫停接單'}</button></div></section>`;
  const summary = prep.size ? `<div class="prep-summary">${icon('leaf', 15)}<strong>待製作</strong>${[...prep].map(([name, qty]) => `<span>${esc(name)} <b>×${qty}</b></span>`).join('')}</div>` : '';
  const hasBoard = Boolean(queue.length || columns[2][2].length);
  const board = hasBoard
    ? `<div class="order-board">${columns.map(column).join('')}</div>`
    : `<section class="panel">${empty(icon('shopping-bag', 30), '目前沒有進行中的訂單', '顧客掃碼點餐後，訂單會即時出現在這裡，並響提示音。', `<a class="btn primary small" href="${esc(orderUrl().replace(location.origin, ''))}" target="_blank" rel="noopener">開啟點餐頁</a>`)}</section>`;
  // 凍結頂端列: ordering status, the prep summary and the column titles stay on screen while the columns scroll.
  const frozen = `<div class="orders-sticky">${control}${summary}${hasBoard ? `<div class="order-board-head">${columns.map(head).join('')}</div>` : ''}</div>`;
  const history = `<section class="panel"><div class="panel-head"><h2>最近完成與取消</h2><span class="badge neutral">今日 ${todays.filter(order => order.status !== 'cancelled').length} 筆 · 已完成營收 ${money(revenue)}</span></div>${finished.map(order => `<div class="row-item ${order.status === 'cancelled' ? 'cancelled' : ''}"><div class="row-main"><strong>${esc(shortOrderNumber(order.number))} ${esc(order.customer?.name || '')} · ${money(order.total)} ${orderBadge(order.status, esc)}</strong><p>${when(order.createdAt)} · ${(order.items || []).map(item => `${esc(item.name)}×${item.quantity}`).join('、')}${order.cancelReason ? ` · 原因：${esc(order.cancelReason)}` : ''}</p></div>${order.status === 'completed' && taipeiDate(order.updatedAt || order.createdAt) === today ? `<button class="text-link" data-action="order-back" data-id="${esc(order.id)}" data-status="ready" title="按錯了？退回可取餐">退回</button>` : ''}</div>`).join('') || '<p class="body-copy">還沒有完成的訂單。</p>'}</section>`;
  return `${frozen}${board}<div class="grid cols-main section-space">${history}<aside class="grid" style="align-content:start"><div class="notice sea" style="margin:0">${icon('shopping-bag', 17)}<span>按按鈕更新狀態，顧客手機上的進度會同步。按錯可以按「退回」；顧客沒來或餐點售完可以「取消」，用掉的折扣碼會退回給顧客。付款於取餐時在餐車現場完成。</span></div></aside></div>${assetKit(state)}`;
}

function analytics(state, context) {
  const { icon, esc, when } = tools(context);
  const published = (state.posts || []).filter(post => post.mode !== 'meta' && post.status === 'published');
  const posts = published.filter(post => post.metrics);
  const totals = posts.reduce((sum, post) => {
    for (const key of ['reach', 'likes', 'comments', 'saves', 'clicks']) sum[key] += Number(post.metrics[key] || 0);
    return sum;
  }, { reach: 0, likes: 0, comments: 0, saves: 0, clicks: 0 });
  const interactions = totals.likes + totals.comments + totals.saves;
  const num = number => Number(number).toLocaleString('zh-TW');
  const ranked = [...posts].sort((a, b) => (Number(b.metrics.likes || 0) + Number(b.metrics.comments || 0) + Number(b.metrics.saves || 0)) - (Number(a.metrics.likes || 0) + Number(a.metrics.comments || 0) + Number(a.metrics.saves || 0)));
  const max = Math.max(1, ...posts.map(post => Number(post.metrics.reach || 0)));
  const bars = posts.slice(-7).map((post, index) => {
    const engagement = Number(post.metrics.likes || 0) + Number(post.metrics.comments || 0) + Number(post.metrics.saves || 0);
    return `<div class="bar-group"><span class="bar" style="height:${Math.max(0, Number(post.metrics.reach || 0) / max * 100)}%" title="${esc(post.title)}｜觸及 ${num(post.metrics.reach || 0)}"></span><span class="bar alt" style="height:${Math.max(0, engagement / max * 100)}%" title="${esc(post.title)}｜互動 ${num(engagement)}"></span><label>${esc((post.title || `貼文 ${index + 1}`).slice(0, 7))}</label></div>`;
  }).join('');
  const missing = published.filter(post => !post.metrics).length;
  return `${metaAnalytics(state)}<div class="notice">${icon('chart', 17)}<span>數字來自你填寫的 IG／FB 後台數據；連結 Meta 的貼文會自動同步。${missing ? `還有 ${missing} 篇已發布貼文沒有填寫成效。` : ''}</span></div><div class="stats">${stat(icon('users', 17), '累積觸及', num(totals.reach), '各篇加總')}${stat(icon('heart', 17), '累積互動', num(interactions), '按讚 + 留言 + 收藏')}${stat(icon('external-link', 17), '連結點擊', num(totals.clicks), '各篇加總')}${stat(icon('pen', 17), '已發布貼文', published.length, `${posts.length} 篇有成效資料`)}</div><div class="grid cols-main"><section class="panel"><div class="panel-head"><h2>各篇觸及與互動</h2></div>${posts.length ? `<div class="bar-chart" role="img" aria-label="各貼文觸及與互動比較，完整數字見下方明細">${bars}</div><div class="calendar-legend"><span class="legend-stall">觸及人次</span><span class="legend-post">互動次數</span></div>` : empty(icon('chart', 30), '還沒有成效資料', '貼文發布後，按「填寫成效」輸入後台數字。', '<a class="btn small" href="/generate">前往貼文工作區</a>')}<div class="section-space wide-table"><table class="source-table"><thead><tr><th>已發布貼文</th><th>觸及</th><th>按讚／留言／收藏</th><th>連結點擊</th><th></th></tr></thead><tbody>${published.map(post => `<tr><td><button class="text-link" data-action="post-edit" data-id="${esc(post.id)}">${esc(post.title || post.topic)}</button><small class="muted" style="display:block;margin-top:4px">${post.platform === 'facebook' ? 'Facebook' : 'Instagram'} · ${when(post.publishedAt)}</small></td>${post.metrics ? `<td>${num(post.metrics.reach || 0)}</td><td>${num(post.metrics.likes || 0)} / ${num(post.metrics.comments || 0)} / ${num(post.metrics.saves || 0)}</td><td>${num(post.metrics.clicks || 0)}</td>` : '<td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>'}<td><button class="btn small ${post.metrics ? '' : 'soft'}" data-action="metrics-open" data-id="${esc(post.id)}">${post.metrics ? '更新' : '填寫成效'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">尚無已發布的貼文。</td></tr>'}</tbody></table></div></section><aside class="grid" style="align-content:start"><section class="panel" style="background:#eef3e9"><div class="panel-head"><h2>回饋到資料中心</h2>${icon('dna', 20)}</div><p class="body-copy">把目前的成效整理成一筆資料加入資料中心，下次重新建立 Brand DNA 時會一起參考。加入後會直接帶你到資料中心。</p><button class="btn primary" data-action="analytics-feedback" style="margin-top:20px;width:100%" ${posts.length ? '' : 'disabled'}>${icon('refresh', 15)} 加入資料中心</button><p class="fine muted" style="margin-top:13px">${state.diagnosis?.feedbackAt ? `上次加入：${when(state.diagnosis.feedbackAt)}` : '還沒加入過。'}</p><a class="text-link" href="/data-hub" style="margin-top:17px">查看資料中心 ${icon('arrow-right', 13)}</a></section><section class="panel"><div class="panel-head"><h2>互動最高的貼文</h2></div>${ranked.length ? `<div class="row-icon" style="margin-bottom:14px">${icon('heart', 19)}</div><h3>${esc(ranked[0].title || ranked[0].topic)}</h3><p class="body-copy" style="margin-top:9px">按讚、留言、收藏加起來最多。下一篇可以參考它的主題和寫法。</p>` : '<p class="body-copy">多發幾篇之後再來比較。</p>'}</section></aside></div>`;
}

function settings(state, context) {
  const { icon, esc, money, dateLabel } = tools(context);
  const brand = state.brand || {};
  const account = ui.account || {};
  const ai = ui.ai;
  const rfm = state.settings?.rfm || {};
  const row = (title, detail, action = '') => `<div class="setting-row"><div><h3>${title}</h3><p>${detail}</p></div>${action}</div>`;
  return `<div class="grid cols-2"><section class="panel"><div class="panel-head"><h2>品牌資料</h2><button class="btn small" data-action="brand-edit">${icon('pen', 12)} 編輯</button></div>
    ${row('店名', esc(brand.name || '—'), `<span class="badge neutral">${esc(brand.shortName || '')}</span>`)}
    ${row('標語與介紹', esc([brand.tagline, brand.description].filter(Boolean).join('｜') || '尚未填寫，會顯示在顧客點餐頁'))}
    ${row('英文名稱', esc(brand.nameEn || '尚未填寫（顧客切換英文時顯示）'), icon('globe', 18))}
    ${row('社群與官網', [brand.instagram && `<a class="text-link" href="${esc(brand.instagram)}" target="_blank" rel="noopener noreferrer">Instagram ${icon('external-link', 11)}</a>`, brand.website && `<a class="text-link" href="${esc(brand.website)}" target="_blank" rel="noopener noreferrer">官網 ${icon('external-link', 11)}</a>`].filter(Boolean).join('　') || '尚未填寫')}
    ${row('時區', '出攤與貼文排程以台北時間顯示。', '<span class="badge neutral">Asia / Taipei</span>')}</section>
  <section class="panel"><div class="panel-head"><h2>帳號</h2>${icon('lock', 18)}</div>
    ${row('登入帳號', `@${esc(account.username || '')}`, '<button class="btn small" data-action="password-open">變更密碼</button>')}
    ${row('一台餐車一個帳號', `這個瀏覽器已登入 ${ui.accounts.length} 台餐車，左上角可以快速切換。`, '<a class="btn small" href="/register?add=1">註冊新餐車</a>')}
    ${row('顧客點餐連結', `<span style="overflow-wrap:anywhere">${esc(orderUrl())}</span>`, '<a class="btn small" href="/orders#asset-kit">QR Code 素材</a>')}
    ${row('登出', '登出後需要重新輸入密碼。', '<button class="btn small danger" data-action="logout">登出這台餐車</button>')}</section>
  <section class="panel" id="member-settings"><div class="panel-head"><h2>會員設定</h2><button class="btn small" data-action="member-settings">${icon('pen', 12)} 調整</button></div>
    ${row('會員資料完成禮', `會員填完性別、出生年、縣市、職業與月收入後，自動送 ${money(state.settings?.profileReward ?? 30)} 折扣碼。`, icon('gift', 18))}
    ${row('RFM 分群條件', `常來客：近 ${rfm.activeDays} 天內消費 ${rfm.loyalOrders} 次以上｜潛在客：消費 2 次或上次滿 NT$${rfm.bigOrder}｜流失客：超過 ${rfm.churnDays} 天沒消費`)}
    ${row('會員識別', '會員以手機號碼識別，推播訊息與折扣碼會出現在顧客點餐頁的「我的會員」。顧客換手機時，在會員資料打開這位會員、按「產生登入碼」交給本人。')}</section>
  <section class="panel" id="ai-settings"><div class="panel-head"><h2>AI 助理</h2><span class="badge ${ai?.enabled ? 'approved' : 'neutral'}">${ai?.enabled ? '啟用中' : '未啟用'}</span></div>
    ${row('模型', ai ? `${esc(ai.model)}（OpenAI 經濟型模型，用於貼文草稿、品牌診斷、趨勢、英文菜單、圖片文字辨識與推播文案）` : '讀取中…', icon('sparkles', 18))}
    ${row('本月用量', ai ? `US$ ${Number(ai.usedUsd || 0).toFixed(4)} / 上限 US$ ${Number(ai.budgetUsd || 0).toFixed(2)} · ${ai.calls || 0} 次呼叫（${esc(ai.month || '')}）` : '—')}
    ${row('沒有 AI 時', ai?.enabled ? '額度用完或連線失敗時，會自動改用內建範本，不會中斷操作。' : '目前使用內建範本產生草稿與診斷。部署時設定 OPENAI_API_KEY 即可啟用。')}</section>
  ${metaSettings()}
  <section class="panel"><div class="panel-head"><h2>資料管理</h2>${icon('settings', 18)}</div>
    ${row('最近動態', esc(state.activity?.[0] ? `${state.activity[0].text}（${dateLabel(state.activity[0].date, { hour: '2-digit', minute: '2-digit' })}）` : '尚無'))}
    ${row('還原初始資料', '貼文、訂單、會員、菜單與折扣碼會回到初始狀態。Meta 連線與匯入的貼文會保留。此動作無法復原。', '<button class="btn small danger" data-action="workspace-reset">還原</button>')}</section></div>`;
}

export function renderSecondary(route, state, context) {
  const key = String(route || '').replace(/^\/+|\/+$/g, '');
  const renderers = { calendar, orders, analytics, settings };
  return renderers[key]?.(state, context);
}
