// 會員管理: members (RFM segments, sortable list, push campaigns, discount codes, demographics) and guests (name + phone only).
import { getState, esc, money, icon } from './client.mjs';
import { ui, dateLabel, daysAgo, btn, empty } from './merchant-ui.mjs';
import { openModal } from './merchant-modals.mjs';

const RFM_DEFAULT = { loyalOrders: 3, activeDays: 30, churnDays: 45, bigOrder: 250 };
export const rfmSettings = state => ({ ...RFM_DEFAULT, ...(state.settings?.rfm || {}) });
export const SEGMENTS = {
  loyal: { label: '常來客', badge: 'approved', icon: 'star', desc: r => `近 ${r.activeDays} 天內消費 ${r.loyalOrders} 次以上` },
  potential: { label: '潛在客', badge: 'scheduled', icon: 'trending', desc: r => `消費過 2 次，或上次消費滿 NT$${r.bigOrder}` },
  churned: { label: '流失客', badge: 'draft', icon: 'clock', desc: r => `超過 ${r.churnDays} 天沒有再消費` },
  new: { label: '新客', badge: 'neutral', icon: 'user', desc: () => '消費過 1 次，金額一般' },
  none: { label: '尚未消費', badge: 'neutral', icon: 'user', desc: () => '加入會員後還沒點過餐' },
};
const PUSH_SEGMENTS = ['loyal', 'potential', 'churned'];
export const profileComplete = d => Boolean(d && d.gender && d.birthYear && d.city && d.occupation && d.income);

/** Recency (last order), frequency (orders) and monetary (spend) per member, plus the segment they fall in. */
export function memberStats(state) {
  const rfm = rfmSettings(state);
  const byMember = new Map();
  for (const order of state.orders || []) if (order.memberId) (byMember.get(order.memberId) || byMember.set(order.memberId, []).get(order.memberId)).push(order);
  return (state.members || []).map(member => {
    const orders = (byMember.get(member.id) || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const count = orders.length;
    const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const last = orders[0] || null;
    const recency = last ? daysAgo(last.createdAt) : null;
    let segment = 'none';
    if (count && recency > rfm.churnDays) segment = 'churned';
    else if (count >= rfm.loyalOrders && recency <= rfm.activeDays) segment = 'loyal';
    else if (count >= 2 || (last && Number(last.total) >= rfm.bigOrder)) segment = 'potential';
    else if (count) segment = 'new';
    return { member, orders, count, total, aov: count ? Math.round(total / count) : 0, last, lastTotal: Number(last?.total || 0), recency, segment, profile: profileComplete(member.demographics) };
  });
}
export function segmentMembers(state, segment) {
  if (segment === 'incomplete') return memberStats(state).filter(row => !row.profile && row.member.optIn !== false);
  return memberStats(state).filter(row => row.segment === segment && row.member.optIn !== false);
}
export const lastCampaign = (state, segment) => (state.campaigns || []).find(campaign => campaign.segment === segment) || null;
/**
 * 訪客: customers who ordered without joining. Only the pickup name and phone are kept here, one row per phone
 * (latest name wins); they are never segmented, pushed to or counted in the member profile. A phone that later
 * joins as a member leaves this list.
 */
export function guestRows(state) {
  const memberPhones = new Set((state.members || []).map(member => member.phone));
  const guests = new Map();
  for (const order of [...(state.orders || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))) {
    const phone = String(order.customer?.phone || '').trim();
    if (order.memberId || !phone || memberPhones.has(phone) || guests.has(phone)) continue;
    guests.set(phone, { name: String(order.customer?.name || '').trim() || '訪客', phone });
  }
  return [...guests.values()];
}
function guestsView(state) {
  const guests = guestRows(state);
  return `<div class="notice sea">${icon('info', 16)}<span>訪客是沒有加入會員、直接點餐的顧客，只記錄取餐姓名與電話，不做分群、推播或輪廓分析。同一支電話之後加入會員，就會移到「會員」。</span></div>
    <section class="panel"><div class="panel-head"><h2>訪客名單 <span class="badge neutral">${guests.length} 位</span></h2></div>${guests.length
      ? `<div class="wide-table"><table class="source-table guest-table"><thead><tr><th>姓名</th><th>電話</th></tr></thead><tbody>${guests.map(guest => `<tr><td><div class="source-title"><span class="avatar mini">${esc(guest.name.slice(0, 1))}</span><strong>${esc(guest.name)}</strong></div></td><td>${esc(guest.phone)}</td></tr>`).join('')}</tbody></table></div>`
      : empty('目前沒有訪客', '沒有加入會員就點餐的顧客會出現在這裡。', '', '')}</section>`;
}

function templates(state) {
  const brand = state.brand?.shortName || '我們';
  const top = [...(state.menu || [])].filter(item => item.available !== false)[0];
  const reward = state.settings?.profileReward ?? 30;
  return {
    loyal: { kind: 'activity', offer: top ? 'bogo' : 'spend', value: 30, min: 200, itemId: top?.id || '', days: 7, title: top ? `熟客感謝：${top.name}買一送一` : '熟客感謝：滿額折 NT$30', message: `謝謝你常來${brand}！這週專屬熟客的優惠，點餐時輸入折扣碼就能使用。` },
    potential: { kind: 'coupon', offer: 'amount', value: 30, min: 0, itemId: '', days: 14, title: '再來一次就折 NT$30', message: `上次的餐還喜歡嗎？${brand}送你專屬折扣，下次點餐輸入折扣碼現折 NT$30。` },
    churned: { kind: 'coupon', offer: 'amount', value: 40, min: 100, itemId: '', days: 21, title: '好久不見，回來吃飯吧', message: `最近好嗎？${brand}想念你了！回來點餐輸入專屬折扣碼，滿 NT$100 折 NT$40。` },
    incomplete: { kind: 'profile', offer: '', value: 0, min: 0, itemId: '', days: 0, title: `填會員資料送 NT$${reward} 折扣碼`, message: `花 1 分鐘填寫會員資料，${brand}立刻送你 NT$${reward} 折扣碼，下次點餐就能用。打開點餐頁的「我的會員」即可填寫。` },
  };
}
const segmentLabel = segment => segment === 'incomplete' ? '未填資料會員' : SEGMENTS[segment]?.label || segment;

export function campaignModal(segment) {
  const state = getState();
  const rows = segmentMembers(state, segment);
  const t = templates(state)[segment] || templates(state).potential;
  const isProfile = segment === 'incomplete';
  const options = (state.menu || []).filter(item => item.available !== false).map(item => `<option value="${esc(item.id)}" ${item.id === t.itemId ? 'selected' : ''}>${esc(item.name)}（${money(item.price)}）</option>`).join('');
  openModal(`推播給${esc(segmentLabel(segment))}`, `<form id="campaign-form" data-segment="${esc(segment)}">
    <div class="notice sea">${icon('send', 16)}<span>會傳送到 <strong>${rows.length}</strong> 位會員的「我的會員」訊息匣${isProfile ? '' : '，並產生只有他們能用的折扣碼'}。${rows.length ? `收件人：${rows.slice(0, 6).map(row => esc(row.member.name)).join('、')}${rows.length > 6 ? ` 等 ${rows.length} 位` : ''}` : '這個分群目前沒有可推播的會員。'}</span></div>
    ${isProfile ? '' : `<div class="field"><label>推播內容</label><div class="segmented" role="radiogroup">
      <label><input type="radio" name="campaign-kind" value="activity" ${t.kind === 'activity' ? 'checked' : ''}><span>${icon('gift', 15)} 活動</span></label>
      <label><input type="radio" name="campaign-kind" value="coupon" ${t.kind === 'coupon' ? 'checked' : ''}><span>${icon('tag', 15)} 專屬折扣碼</span></label></div></div>
    <div class="grid cols-2 form-grid"><div class="field"><label for="offer-kind">優惠方式</label><select id="offer-kind" data-initial="${esc(t.offer)}"></select></div>
      <div class="field"><label for="offer-days">有效天數</label><input id="offer-days" type="number" min="1" max="365" value="${t.days}" required></div></div>
    <div class="field" data-offer="bogo"><label for="offer-item">買一送一的餐點</label><select id="offer-item">${options || '<option value="">請先到菜單管理新增餐點</option>'}</select><small>顧客點 2 份會折 1 份的價格。</small></div>
    <div class="grid cols-2 form-grid"><div class="field" data-offer="amount spend percent"><label for="offer-value" id="offer-value-label">折抵金額（NT$）</label><input id="offer-value" type="number" min="1" max="5000" value="${t.value}"></div>
      <div class="field" data-offer="amount spend"><label for="offer-min">最低消費（NT$，選填）</label><input id="offer-min" type="number" min="0" max="100000" value="${t.min || ''}" placeholder="不限"></div></div>`}
    <div class="field"><label for="campaign-title">推播標題</label><input id="campaign-title" maxlength="60" required value="${esc(t.title)}"></div>
    <div class="field"><label for="campaign-message">推播內容 <button type="button" class="text-link" data-action="campaign-ai" style="margin-left:8px">${icon('sparkles', 12)} AI 幫我寫</button></label><textarea id="campaign-message" maxlength="500" required style="min-height:100px">${esc(t.message)}</textarea><small>${isProfile ? '會員完成資料後會自動收到折扣碼。' : '送出時會自動附上折扣碼與使用條件。'}</small></div>
    <div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit" ${rows.length ? '' : 'disabled'}>${icon('send', 14)} 送出推播</button></div></form>`);
  syncCampaignForm();
}
/** Keeps the offer options in step with 活動／專屬折扣碼 and shows only the fields the chosen offer needs. */
export function syncCampaignForm() {
  const form = document.getElementById('campaign-form');
  const select = document.getElementById('offer-kind');
  if (!form || !select) return;
  const kind = form.querySelector('input[name="campaign-kind"]:checked')?.value || 'coupon';
  const choices = kind === 'activity' ? [['bogo', '買一送一（指定餐點）'], ['spend', '滿額折抵'], ['percent', '全單打折']] : [['amount', '折抵金額'], ['percent', '全單打折']];
  const current = select.value || select.dataset.initial;
  select.innerHTML = choices.map(([value, label]) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`).join('');
  const offer = select.value;
  form.querySelectorAll('[data-offer]').forEach(el => { el.hidden = !el.dataset.offer.split(' ').includes(offer); });
  const label = document.getElementById('offer-value-label');
  const value = document.getElementById('offer-value');
  if (label && value) {
    label.textContent = offer === 'percent' ? '折扣百分比（%，例如 10 = 九折）' : '折抵金額（NT$）';
    value.max = offer === 'percent' ? '90' : '5000';
  }
}
export function campaignPayload(form) {
  const state = getState();
  const segment = form.dataset.segment;
  const isProfile = segment === 'incomplete';
  const payload = {
    segment, segmentLabel: segmentLabel(segment), recipients: segmentMembers(state, segment).map(row => row.member.id),
    kind: isProfile ? 'profile' : form.querySelector('input[name="campaign-kind"]:checked')?.value || 'coupon',
    title: document.getElementById('campaign-title').value.trim(), message: document.getElementById('campaign-message').value.trim(),
  };
  if (!isProfile) {
    const offer = document.getElementById('offer-kind').value;
    const value = Number(document.getElementById('offer-value')?.value || 0);
    const min = Number(document.getElementById('offer-min')?.value || 0);
    payload.days = Number(document.getElementById('offer-days').value || 14);
    payload.offer = offer === 'bogo' ? { kind: 'bogo', itemId: document.getElementById('offer-item').value }
      : offer === 'percent' ? { kind: 'percent', value } : { kind: 'amount', value, minSpend: offer === 'spend' || min ? min : 0 };
  }
  return payload;
}
export function campaignCopyInput(form) {
  const offer = document.getElementById('offer-kind');
  return { segmentLabel: segmentLabel(form.dataset.segment), kind: form.dataset.segment === 'incomplete' ? 'profile' : form.querySelector('input[name="campaign-kind"]:checked')?.value, offerLabel: offer ? offer.options[offer.selectedIndex]?.text + ' ' + (document.getElementById('offer-value')?.value || '') : '填寫會員資料送折扣碼', days: Number(document.getElementById('offer-days')?.value || 0) || null };
}

export function couponModal() {
  const state = getState();
  const options = (state.menu || []).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  openModal('新增折扣碼', `<form id="coupon-form">
    <div class="notice sea">${icon('tag', 16)}<span>公開折扣碼任何顧客都能在結帳時輸入，適合貼在 IG、海報或活動現場。只給特定會員的折扣請用「推播」。</span></div>
    <div class="grid cols-2 form-grid"><div class="field"><label for="coupon-code">折扣碼（選填）</label><input id="coupon-code" maxlength="20" placeholder="留白自動產生，例如 IG20" style="text-transform:uppercase"></div>
    <div class="field"><label for="coupon-kind">優惠方式</label><select id="coupon-kind"><option value="amount">折抵金額</option><option value="percent">全單打折</option><option value="bogo">買一送一</option></select></div></div>
    <div class="grid cols-2 form-grid"><div class="field" data-coupon="amount percent"><label for="coupon-value">金額（NT$）或百分比（%）</label><input id="coupon-value" type="number" min="1" max="5000" value="20"></div>
    <div class="field" data-coupon="bogo" hidden><label for="coupon-item">買一送一餐點</label><select id="coupon-item">${options}</select></div>
    <div class="field"><label for="coupon-min">最低消費（NT$）</label><input id="coupon-min" type="number" min="0" max="100000" value="0"></div></div>
    <div class="grid cols-2 form-grid"><div class="field"><label for="coupon-max">可使用次數（選填）</label><input id="coupon-max" type="number" min="1" max="100000" placeholder="不限"></div>
    <div class="field"><label for="coupon-days">有效天數（0 = 不限）</label><input id="coupon-days" type="number" min="0" max="365" value="30"></div></div>
    <div class="field"><label for="coupon-label">顯示名稱（選填）</label><input id="coupon-label" maxlength="60" placeholder="例如：IG 粉絲折 NT$20"></div>
    <div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit">建立折扣碼</button></div></form>`);
}
export function couponPayload() {
  const kind = document.getElementById('coupon-kind').value;
  const max = document.getElementById('coupon-max').value;
  return {
    code: document.getElementById('coupon-code').value.trim().toUpperCase(), kind, label: document.getElementById('coupon-label').value.trim(),
    value: Number(document.getElementById('coupon-value').value || 0), itemId: document.getElementById('coupon-item').value,
    minSpend: Number(document.getElementById('coupon-min').value || 0), days: Number(document.getElementById('coupon-days').value || 0), ...(max ? { maxUses: Number(max) } : {}),
  };
}
export function syncCouponForm() {
  const kind = document.getElementById('coupon-kind')?.value;
  document.querySelectorAll('#coupon-form [data-coupon]').forEach(el => { el.hidden = !el.dataset.coupon.split(' ').includes(kind); });
}

const ageGroup = year => { if (!year) return ''; const age = new Date().getFullYear() - Number(year); return age < 20 ? '20 歲以下' : age < 30 ? '20–29 歲' : age < 40 ? '30–39 歲' : age < 50 ? '40–49 歲' : '50 歲以上'; };
function distribution(rows, pick, limit = 4) {
  const counts = new Map();
  for (const row of rows) { const value = pick(row); if (value) counts.set(value, (counts.get(value) || 0) + 1); }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { total, items: [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit) };
}
function bars(title, data) {
  return `<div class="dist"><h4>${title}</h4>${data.items.length ? data.items.map(([label, count]) => `<div class="dist-row"><span>${esc(label)}</span><span class="dist-track"><i style="width:${Math.round(count / data.total * 100)}%"></i></span><b>${count}</b></div>`).join('') : '<p class="fine muted">尚無資料</p>'}</div>`;
}

export function memberDetail(id) {
  const state = getState();
  const row = memberStats(state).find(entry => entry.member.id === id);
  if (!row) return;
  const d = row.member.demographics || {};
  const fields = [['性別', d.gender], ['出生年', d.birthYear], ['居住地', [d.city, d.district].filter(Boolean).join(' ')], ['職業', d.occupation], ['月收入', d.income], ['家庭', d.household], ['飲食偏好', (d.diet || []).join('、')], ['得知管道', d.channel]];
  const offers = (state.coupons || []).filter(coupon => coupon.memberIds?.includes(id));
  openModal(esc(row.member.name), `<div class="member-detail"><div class="stats compact">${[['分群', `<span class="badge ${SEGMENTS[row.segment].badge}">${SEGMENTS[row.segment].label}</span>`], ['消費次數', `${row.count} 次`], ['累積消費', money(row.total)], ['平均客單價', money(row.aov)]].map(([label, value]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-number small">${value}</div></div>`).join('')}</div>
    <p class="body-copy">手機 ${esc(row.member.phone)} · 加入於 ${dateLabel(row.member.createdAt, { year: 'numeric' })} · ${row.member.optIn === false ? '不接收推播' : '接收推播'}</p>
    <h3 class="section-title">會員資料 ${row.profile ? '<span class="badge approved">已完成</span>' : '<span class="badge draft">未完成</span>'}</h3>
    <div class="kv-grid">${fields.map(([label, value]) => `<div><small>${label}</small><strong>${esc(value || '—')}</strong></div>`).join('')}</div>
    <h3 class="section-title">最近訂單</h3>${row.orders.slice(0, 6).map(order => `<div class="row-item"><div class="row-main"><strong>#${esc(order.number)} · ${money(order.total)}${order.discount ? ` <span class="badge scheduled">${esc(order.discount.code)}</span>` : ''}</strong><p>${dateLabel(order.createdAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${(order.items || []).map(item => `${esc(item.name)}×${item.quantity}`).join('、')}</p></div></div>`).join('') || '<p class="body-copy">還沒有訂單。</p>'}
    <h3 class="section-title">專屬優惠</h3>${offers.map(coupon => `<div class="row-item"><div class="row-main"><strong>${esc(coupon.code)} · ${esc(coupon.label)}</strong><p>${coupon.usedBy.includes(id) ? '已使用' : coupon.expiresAt && coupon.expiresAt < new Date().toISOString() ? '已過期' : `可使用${coupon.expiresAt ? `，到 ${dateLabel(coupon.expiresAt)}` : ''}`}</p></div></div>`).join('') || '<p class="body-copy">目前沒有專屬優惠。</p>'}
    <h3 class="section-title">換手機登入</h3><div class="login-code-box" id="member-login-code"><span>顧客換了手機或清除瀏覽器後，用同一支手機號碼加入會員需要登入碼（防止別人輸入他的號碼冒用優惠）。確認是本人後再產生。</span>${btn(`${icon('lock', 12)} 產生登入碼`, 'member-login-code', 'small', `data-id="${esc(id)}"`)}</div>
    <div class="modal-actions">${btn(`${icon('trash', 13)} 刪除會員`, 'member-delete', 'danger', `data-id="${esc(id)}"`)}${btn('關閉', 'modal-close', 'primary')}</div></div>`, { wide: true });
}

const SORTS = {
  name: row => row.member.name, last: row => row.last ? Date.parse(row.last.createdAt) : 0, count: row => row.count, total: row => row.total,
  aov: row => row.aov, lastTotal: row => row.lastTotal, joined: row => Date.parse(row.member.createdAt) || 0,
};
function sortHead(key, label) {
  const active = ui.memberSort.key === key;
  return `<th><button class="sort-head ${active ? 'active' : ''}" data-action="member-sort" data-key="${key}" aria-label="依${label}排序">${label}${active ? icon(ui.memberSort.dir === 'asc' ? 'arrow-up' : 'arrow-down', 11) : ''}</button></th>`;
}

export function membersView(state) {
  const tab = ui.memberTab === 'guests' ? 'guests' : 'members';
  const tabs = `<div class="tabs page-tabs" role="tablist" aria-label="會員管理">${[['members', 'users', '會員', (state.members || []).length], ['guests', 'user', '訪客', guestRows(state).length]].map(([key, i, label, count]) => `<button role="tab" aria-selected="${tab === key}" class="tab ${tab === key ? 'active' : ''}" data-action="member-tab" data-tab="${key}">${icon(i, 14)} ${label} <small>${count}</small></button>`).join('')}</div>`;
  return `${tabs}${tab === 'guests' ? guestsView(state) : membersPanel(state)}`;
}
function membersPanel(state) {
  const rfm = rfmSettings(state);
  const stats = memberStats(state);
  const counts = Object.fromEntries(Object.keys(SEGMENTS).map(key => [key, stats.filter(row => row.segment === key).length]));
  const filter = ui.memberSegment;
  const sorter = SORTS[ui.memberSort.key] || SORTS.last;
  const rows = stats.filter(row => filter === 'all' || row.segment === filter).sort((a, b) => {
    const x = sorter(a), y = sorter(b);
    const order = typeof x === 'string' ? x.localeCompare(y, 'zh-Hant') : x - y;
    return ui.memberSort.dir === 'asc' ? order : -order;
  });
  const incomplete = stats.filter(row => !row.profile);
  const segmentCards = PUSH_SEGMENTS.map(key => {
    const segment = SEGMENTS[key];
    const members = stats.filter(row => row.segment === key);
    const spend = members.length ? Math.round(members.reduce((sum, row) => sum + row.aov, 0) / members.length) : 0;
    const last = lastCampaign(state, key);
    return `<section class="segment-card ${key}"><div class="segment-top"><span class="segment-icon">${icon(segment.icon, 18)}</span><div><h3>${segment.label}</h3><p>${segment.desc(rfm)}</p></div><strong>${members.length}<small> 位</small></strong></div>
      <div class="segment-meta"><span>平均客單價 ${money(spend)}</span><span>${last ? `上次推播 ${dateLabel(last.sentAt)}` : '尚未推播'}</span></div>
      <div class="segment-actions">${btn(`${icon('send', 13)} 推播優惠`, 'campaign-new', 'primary small', `data-segment="${key}" ${members.length ? '' : 'disabled'}`)}${btn('查看名單', 'member-filter', 'small', `data-segment="${key}"`)}</div></section>`;
  }).join('');
  const table = rows.length ? `<div class="wide-table"><table class="source-table member-table"><thead><tr>${sortHead('name', '會員')}<th>分群</th>${sortHead('last', '上次消費')}${sortHead('count', '次數')}${sortHead('total', '累積消費')}${sortHead('aov', '平均單價')}${sortHead('lastTotal', '上次金額')}<th>會員資料</th></tr></thead><tbody>${rows.map(row => `<tr class="clickable" data-action="member-open" data-id="${esc(row.member.id)}" tabindex="0"><td><div class="source-title"><span class="avatar mini">${esc(row.member.name.slice(0, 1))}</span><span><strong>${esc(row.member.name)}</strong><small>${esc(row.member.phone)}</small></span></div></td><td><span class="badge ${SEGMENTS[row.segment].badge}">${SEGMENTS[row.segment].label}</span></td><td>${row.last ? `${dateLabel(row.last.createdAt)}<small class="muted" style="display:block">${row.recency === 0 ? '今天' : `${row.recency} 天前`}</small>` : '<span class="muted">—</span>'}</td><td>${row.count}</td><td>${money(row.total)}</td><td>${row.count ? money(row.aov) : '—'}</td><td>${row.count ? money(row.lastTotal) : '—'}</td><td>${row.profile ? '<span class="badge approved">已填寫</span>' : '<span class="badge neutral">未填寫</span>'}</td></tr>`).join('')}</tbody></table></div>`
    : empty('這個分群目前沒有會員', '顧客在點餐頁加入會員後就會出現在這裡。', '', '');
  const demo = stats.map(row => row.member.demographics).filter(Boolean);
  const pct = stats.length ? Math.round((stats.length - incomplete.length) / stats.length * 100) : 0;
  const coupons = (state.coupons || []).slice(0, 12);
  const campaigns = (state.campaigns || []).slice(0, 8);
  return `<div class="stats">${[['all', '會員數', stats.length, `${stats.filter(row => row.count).length} 位有消費紀錄`, 'users'], ['loyal', '常來客', counts.loyal, SEGMENTS.loyal.desc(rfm), 'star'], ['potential', '潛在客', counts.potential, SEGMENTS.potential.desc(rfm), 'trending'], ['churned', '流失客', counts.churned, SEGMENTS.churned.desc(rfm), 'clock']].map(([key, label, value, note, i]) => `<button class="stat stat-button ${filter === key ? 'active' : ''}" data-action="member-filter" data-segment="${key}"><span class="stat-icon">${icon(i, 17)}</span><div class="stat-label">${label}</div><div class="stat-number">${value}</div><div class="stat-note">${note}</div></button>`).join('')}</div>
  <div class="segment-grid">${segmentCards}</div>
  <div class="grid cols-main section-space"><section class="panel"><div class="panel-head"><h2>會員列表 <span class="badge neutral">${rows.length} 位</span></h2><div class="list-filters" style="margin:0">${['all', 'loyal', 'potential', 'churned', 'new', 'none'].map(key => `<button class="filter-btn ${filter === key ? 'active' : ''}" data-action="member-filter" data-segment="${key}">${key === 'all' ? '全部' : SEGMENTS[key].label} <small>${key === 'all' ? stats.length : counts[key]}</small></button>`).join('')}</div></div>
    <p class="fine muted" style="margin:-6px 0 12px">點欄位標題可以排序，點會員查看訂單與資料。分群條件可在工作區設定調整。</p>${table}</section>
  <aside class="grid" style="align-content:start"><section class="panel"><div class="panel-head"><h2>${icon('users', 16)} 會員輪廓</h2><a class="text-link" href="/settings#member-settings">設定</a></div>
    <div class="source-progress" style="margin-top:0"><span>會員資料完成率</span><strong>${stats.length - incomplete.length} / ${stats.length}（${pct}%）</strong></div><div class="progress-track"><span style="width:${pct}%"></span></div>
    <p class="body-copy" style="margin:12px 0">填完資料的會員會自動收到 ${money(state.settings?.profileReward ?? 30)} 折扣碼。還沒填的會員可以再推播邀請。</p>
    ${btn(`${icon('send', 13)} 邀請 ${incomplete.length} 位會員填寫資料`, 'campaign-new', 'soft small', `data-segment="incomplete" ${incomplete.length ? '' : 'disabled'}`)}
    <div class="dist-grid">${bars('性別', distribution(demo.map(d => ({ d })), r => r.d.gender))}${bars('年齡層', distribution(demo.map(d => ({ d })), r => ageGroup(r.d.birthYear)))}${bars('居住縣市', distribution(demo.map(d => ({ d })), r => r.d.city))}${bars('職業', distribution(demo.map(d => ({ d })), r => r.d.occupation))}${bars('月收入', distribution(demo.map(d => ({ d })), r => r.d.income, 6))}${bars('得知管道', distribution(demo.map(d => ({ d })), r => r.d.channel))}</div></section>
  <section class="panel"><div class="panel-head"><h2>${icon('tag', 16)} 折扣碼</h2>${btn(`${icon('plus', 12)} 新增`, 'coupon-new', 'small')}</div>${coupons.map(coupon => `<div class="row-item coupon-row ${coupon.active ? '' : 'inactive'}"><div class="row-main"><strong><code>${esc(coupon.code)}</code> ${esc(coupon.label)}</strong><p>${coupon.memberIds ? `專屬 ${coupon.memberIds.length} 位會員` : '公開'} · 已用 ${coupon.uses}${coupon.maxUses ? ` / ${coupon.maxUses}` : ''} 次${coupon.expiresAt ? ` · 到 ${dateLabel(coupon.expiresAt)}` : ''}</p></div><label class="switch" title="${coupon.active ? '停用' : '啟用'}"><input type="checkbox" data-action="coupon-toggle" data-id="${esc(coupon.id)}" ${coupon.active ? 'checked' : ''} aria-label="${coupon.active ? '停用' : '啟用'} ${esc(coupon.code)}"><span></span></label></div>`).join('') || '<p class="body-copy">還沒有折扣碼。</p>'}</section>
  <section class="panel"><div class="panel-head"><h2>${icon('send', 16)} 推播紀錄</h2></div>${campaigns.map(campaign => { const coupon = (state.coupons || []).find(row => row.id === campaign.couponId); return `<div class="row-item"><div class="row-main"><strong>${esc(campaign.title)}</strong><p>${esc(campaign.segmentLabel)} ${campaign.recipients.length} 位 · ${dateLabel(campaign.sentAt)}${coupon ? ` · <code>${esc(coupon.code)}</code> 已兌換 ${coupon.uses} 次` : ''}</p></div></div>`; }).join('') || '<p class="body-copy">還沒有推播紀錄。</p>'}</section></aside></div>`;
}
