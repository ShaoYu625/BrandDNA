// 通知中心: only things the merchant should act on, grouped by category, with per-browser read state.
import { esc, icon } from './client.mjs';
import { metaStatus } from './merchant-meta.mjs';
import { ui, dateLabel, taipeiToday, topicLabel, store, remember } from './merchant-ui.mjs';
import { memberStats, lastCampaign } from './merchant-members.mjs';
import { isOverdue } from './secondary.mjs';

export const CATEGORIES = [['all', '全部'], ['order', '訂單'], ['post', '貼文'], ['stall', '出攤'], ['member', '會員'], ['system', '系統']];
const CATEGORY_ICON = { order: 'shopping-bag', post: 'pen', stall: 'truck', member: 'users', system: 'settings' };

export function notifications(state) {
  const items = [];
  const now = Date.now();
  const add = item => items.push(item);
  const fresh = (orders = []) => orders.map(order => order.id).sort().join('.').slice(0, 120);

  const waiting = (state.orders || []).filter(order => order.status === 'new');
  if (waiting.length) add({ id: `order-new-${fresh(waiting)}`, cat: 'order', urgent: true, title: `${waiting.length} 筆新訂單等待接單`, detail: waiting.slice(0, 3).map(order => `#${order.number} ${order.customer?.name || ''}`).join('、'), time: waiting[0].createdAt, href: '/orders' });
  const stuck = (state.orders || []).filter(order => order.status === 'ready' && now - Date.parse(order.updatedAt || order.createdAt) > 40 * 60000);
  if (stuck.length) add({ id: `order-ready-${fresh(stuck)}`, cat: 'order', title: `${stuck.length} 筆訂單已可取餐但尚未完成`, detail: '顧客取餐後記得按「完成取餐」；收攤時可以在訂單頁按「全部完成取餐」，沒來取的請「取消」。', time: stuck[0].createdAt, href: '/orders' });
  if (state.settings?.ordering?.paused) add({ id: `ordering-paused-${taipeiToday()}`, cat: 'order', urgent: true, title: '線上接單已暫停', detail: '顧客目前無法送出新訂單。要開始接單時，到訂單管理按「恢復接單」。', time: null, href: '/orders' });

  const suggestion = (state.posts || []).find(post => post.id === state.assistant?.suggestionPostId && post.status === 'draft');
  if (suggestion) add({ id: `assistant-${suggestion.id}`, cat: 'post', urgent: true, title: `已經 ${state.assistant.idleDays || 3} 天沒有發文`, detail: `幫你準備好「${topicLabel(suggestion.topicKey)}」草稿：${suggestion.title}，確認後就能發布。`, time: suggestion.createdAt, action: 'post-edit', data: suggestion.id });
  const drafts = (state.posts || []).filter(post => post.status === 'draft' && post.id !== suggestion?.id);
  if (drafts.length) add({ id: `drafts-${drafts.length}-${drafts[0].id}`, cat: 'post', title: `${drafts.length} 則草稿等待確認`, detail: '確認後才能發布或排程。', time: drafts[0].createdAt, href: '/generate' });
  const overdue = (state.posts || []).filter(post => isOverdue(post, now)).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  if (overdue.length) add({ id: `posts-overdue-${overdue.map(post => post.id).join('.').slice(0, 120)}`, cat: 'post', urgent: true, title: `${overdue.length} 則排程貼文時間已過、還沒發布`, detail: `沒有連結 Meta 的排程不會自動發出。請把「${overdue[0].title}」貼到 ${overdue[0].platform === 'facebook' ? 'Facebook' : 'Instagram'} 後按「標記為已發布」，或重新排程。`, time: overdue[0].scheduledAt, action: 'post-edit', data: overdue[0].id });
  for (const post of (state.posts || []).filter(row => row.meta && ['failed', 'unknown'].includes(row.meta.status))) {
    add({ id: `meta-${post.id}-${post.meta.status}`, cat: 'post', urgent: true, title: post.meta.status === 'failed' ? 'Meta 發布失敗' : 'Meta 發布結果待確認', detail: post.title, time: post.meta.attemptedAt || post.createdAt, action: 'post-edit', data: post.id });
  }

  const today = taipeiToday();
  const soon = (state.stalls || []).filter(stall => stall.date >= today && stall.date <= taipeiToday(2));
  for (const stall of soon) {
    const announced = (state.posts || []).some(post => (post.topicKey === 'stall' || /出車|出攤|預告/.test(post.title + post.topic)) && post.status !== 'draft' && Date.parse(post.createdAt) > Date.parse(`${stall.date}T00:00:00+08:00`) - 4 * 86400000);
    if (!announced) add({ id: `stall-${stall.id}-${stall.date}`, cat: 'stall', urgent: stall.date <= taipeiToday(1), title: `${stall.date === today ? '今天' : dateLabel(stall.date)} ${stall.start} 出攤還沒有預告貼文`, detail: `${stall.title}｜${stall.location}`, time: null, action: 'post-new', data: `${dateLabel(stall.date)} ${stall.location} 出車預告`, topicKey: 'stall' });
  }
  if (!(state.stalls || []).some(stall => stall.date >= today && stall.date <= taipeiToday(7))) add({ id: `stall-none-${today}`, cat: 'stall', title: '未來 7 天還沒有安排出攤', detail: '排好行程後，系統會提醒你發預告。', time: null, href: '/calendar' });
  if (!(state.menu || []).length) add({ id: 'menu-empty', cat: 'stall', urgent: true, title: '還沒有建立菜單', detail: '新增餐點後，顧客才能掃碼點餐。', time: null, href: '/menu' });

  const stats = memberStats(state);
  const joined = (state.members || []).filter(member => now - Date.parse(member.createdAt) < 86400000);
  if (joined.length) add({ id: `members-new-${joined.map(m => m.id).join('.').slice(0, 120)}`, cat: 'member', title: `${joined.length} 位新會員加入`, detail: joined.slice(0, 3).map(member => member.name).join('、'), time: joined[0].createdAt, href: '/members' });
  const churned = stats.filter(row => row.segment === 'churned');
  const churnPush = lastCampaign(state, 'churned');
  if (churned.length && (!churnPush || now - Date.parse(churnPush.sentAt) > 14 * 86400000)) add({ id: `churned-${churned.length}-${today.slice(0, 7)}`, cat: 'member', title: `${churned.length} 位流失客很久沒來了`, detail: '推播回流優惠，邀請他們再來吃。', time: null, action: 'campaign-new', data: 'churned' });
  const incomplete = stats.filter(row => !row.profile);
  const invite = lastCampaign(state, 'incomplete');
  if (incomplete.length >= 3 && (!invite || now - Date.parse(invite.sentAt) > 14 * 86400000)) add({ id: `profile-${incomplete.length}-${today.slice(0, 7)}`, cat: 'member', title: `${incomplete.length} 位會員還沒填會員資料`, detail: '推播邀請填寫，完成後會自動送折扣碼。', time: null, action: 'campaign-new', data: 'incomplete' });

  for (const platform of ['instagram', 'facebook']) {
    const row = metaStatus()?.platforms?.[platform];
    if (row?.state === 'reauthorize') add({ id: `meta-auth-${platform}`, cat: 'system', urgent: true, title: `${platform === 'instagram' ? 'Instagram' : 'Facebook'} 連線需要重新授權`, detail: '重新連線後才能自動發布與同步成效。', time: null, href: '/settings' });
  }
  const pending = (state.sources || []).filter(source => source.status !== 'analyzed');
  if (pending.length) add({ id: `sources-${pending.length}-${pending[0].id}`, cat: 'system', title: `${pending.length} 筆品牌資料還沒分析`, detail: '分析後重新建立 Brand DNA，貼文會更貼近品牌。', time: pending[0].createdAt, href: '/data-hub' });
  if (ui.ai && !ui.ai.enabled) add({ id: 'ai-off', cat: 'system', title: 'AI 助理尚未啟用', detail: '目前使用內建範本產生草稿，啟用後可自動寫文、翻譯菜單與辨識圖片。', time: null, href: '/settings#ai-settings' });
  return items;
}

const readSet = () => new Set(store('notify.read', []));
export const unreadCount = state => { const read = readSet(); return notifications(state).filter(item => !read.has(item.id)).length; };
export function markRead(ids) {
  const read = readSet();
  for (const id of ids) read.add(id);
  remember('notify.read', [...read].slice(-300));
}

export function notifyPopover(state) {
  const all = notifications(state);
  const read = readSet();
  const shown = all.filter(item => ui.notifyTab === 'all' || item.cat === ui.notifyTab);
  const count = cat => all.filter(item => (cat === 'all' || item.cat === cat) && !read.has(item.id)).length;
  return `<div class="popover notify-popover" role="dialog" aria-label="通知"><div class="popover-head"><strong>通知</strong>${all.some(item => !read.has(item.id)) ? '<button class="text-link" data-action="notify-read-all">全部標為已讀</button>' : ''}</div>
    <div class="notify-tabs" role="tablist">${CATEGORIES.map(([key, label]) => `<button role="tab" aria-selected="${ui.notifyTab === key}" class="${ui.notifyTab === key ? 'active' : ''}" data-action="notify-tab" data-tab="${key}">${label}${count(key) ? `<b>${count(key)}</b>` : ''}</button>`).join('')}</div>
    <div class="notify-list">${shown.length ? shown.map(item => `<button class="notify-item ${read.has(item.id) ? 'read' : ''} ${item.urgent ? 'urgent' : ''}" data-action="notify-open" data-id="${esc(item.id)}"><span class="notify-icon ${item.cat}">${icon(CATEGORY_ICON[item.cat], 15)}</span><span class="notify-copy"><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small>${item.time ? `<em>${dateLabel(item.time, { hour: '2-digit', minute: '2-digit' })}</em>` : ''}</span>${read.has(item.id) ? '' : '<i class="notify-dot" aria-label="未讀"></i>'}</button>`).join('') : `<div class="notify-empty">${icon('check', 22)}<p>這個分類目前沒有需要處理的事。</p></div>`}</div></div>`;
}
export const findNotification = (state, id) => notifications(state).find(item => item.id === id);
