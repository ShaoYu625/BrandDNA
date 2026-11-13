// Page renderers for the merchant workspace (pure HTML strings from the current state).
import { getState, esc, money, icon } from './client.mjs';
import { renderSecondary, isOverdue } from './secondary.mjs';
import { metaImportPanel, postBadge } from './merchant-meta.mjs';
import { ui, titles, dateLabel, badge, arrow, btn, empty, info, logo, initial, orderPath, taipeiToday, TOPICS, topicLabel, daysAgo } from './merchant-ui.mjs';
import { switcherPanel, accountMenu } from './merchant-auth.mjs';
import { notifyPopover, unreadCount } from './merchant-notify.mjs';
import { membersView } from './merchant-members.mjs';
import { menuView } from './merchant-menu.mjs';
import { guideView } from './merchant-guide.mjs';
import { SOURCE_TYPES } from './merchant-modals.mjs';
import { festiveMark } from './festive.mjs';
import { importPanel } from './merchant-import.mjs';
import { quickStart } from './merchant-quickstart.mjs';
import { libTag, comparisonPanel } from './merchant-dna.mjs';

export { logo };
export const navs = [
  ['dashboard', '/dashboard', 'grid', '商家總覽'],
  ['data', '/data-hub', 'database', '資料中心'],
  ['diagnosis', '/diagnosis', 'dna', '品牌診斷'],
  ['posts', '/generate', 'pen', '貼文工作區'],
  ['calendar', '/calendar', 'calendar', '行事曆與發文'],
  ['analytics', '/analytics', 'chart', '貼文成效'],
];
const operations = [
  ['orders', '/orders', 'shopping-bag', '訂單管理'],
  ['menu', '/menu', 'leaf', '菜單管理'],
  ['members', '/members', 'users', '會員管理'],
];
function greeting() {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false }));
  return hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安';
}
export function heading() {
  const s = getState();
  const drafts = s.posts.filter(p => p.status === 'draft').length,
    newOrders = s.orders.filter(o => o.status === 'new').length;
  const copy = {
    dashboard: drafts || newOrders ? `目前有 ${drafts} 則草稿待確認、${newOrders} 筆新訂單。` : '草稿和訂單都處理完了。',
    data: '品牌介紹、官網、社群貼文和菜單資料都從這裡新增；按「分析」後，品牌診斷會從這些內容整理。',
    diagnosis: '依資料中心的內容整理品牌定位、語氣、客群、差異化與內容主軸。',
    posts: '產生草稿後可以改文案、換照片，確認過才能發布或排程。',
    calendar: '出攤行程和貼文排程放在同一個月曆上。',
    orders: '顧客送出的訂單會出現在這裡，依序接單、製作、通知取餐。',
    menu: '新增、編輯餐點，設定今日售完與英文菜單。',
    analytics: '已發布貼文的觸及和互動，可以回饋到資料中心。',
    members: '會員依消費紀錄自動分群、推播活動與專屬折扣碼；沒加入會員的訪客另外列出，不做分析。',
    settings: '品牌資料、帳號、會員設定、AI 助理與外部串接。',
    guide: '從帳號、菜單、點餐到行銷，一步一步學會所有功能。',
  };
  let action = '';
  if (ui.route === 'dashboard') action = `<a class="btn" href="${esc(orderPath())}" target="_blank" rel="noopener">${icon('eye', 14)}顧客點餐頁</a>${btn(`${icon('plus', 14)}建立貼文`, 'post-new', 'primary')}`;
  if (ui.route === 'diagnosis') action = btn(`${icon('sparkles', 14)}重新建立 Brand DNA`, 'diagnosis-run', 'primary');
  if (ui.route === 'posts') action = btn(`${icon('plus', 14)}建立貼文`, 'post-new', 'primary');
  if (ui.route === 'calendar') action = btn(`${icon('plus', 14)}新增出攤`, 'stall-new', 'primary');
  if (ui.route === 'orders') action = `<a class="btn primary" href="${esc(orderPath())}" target="_blank" rel="noopener">${icon('external-link', 14)}開啟顧客點餐</a>`;
  if (ui.route === 'menu') action = `${btn(`${icon('globe', 14)}AI 翻譯英文菜單`, 'menu-translate')}${btn(`${icon('plus', 14)}新增餐點`, 'menu-edit', 'primary')}`;
  if (ui.route === 'members') action = btn(`${icon('tag', 14)}新增折扣碼`, 'coupon-new');
  return `<div class="page-heading"><div>${ui.route === 'dashboard' ? '<div class="greeting">TODAY</div>' : ''}<h1>${ui.route === 'dashboard' ? `${greeting()}，${esc(s.brand.shortName)}` : titles[ui.route]}${ui.route === 'diagnosis' ? '<span class="page-chip">BRAND DNA</span>' : ''}</h1><p>${copy[ui.route]}</p></div><div class="actions">${action}</div></div>`;
}
function navLink(route, url, i, label, count = 0) {
  return `<a class="nav-link ${ui.route === route ? 'active' : ''}" href="${url}">${icon(i, 17)}${label}${count ? `<span class="count">${count}</span>` : ''}</a>`;
}
export function shell(content) {
  const s = getState();
  const newOrders = s.orders.filter(o => o.status === 'new').length;
  const drafts = s.posts.filter(p => p.status === 'draft').length;
  const unread = unreadCount(s);
  const name = ui.account?.name || s.brand.name;
  return `<div class="app-shell"><div class="mobile-overlay" data-action="nav-close"></div><aside class="sidebar"><a href="/dashboard" class="logo">${festiveMark(logo())}BrandDNA<span class="beta">TRUCK</span></a>
    <div class="popover-wrap switcher-wrap"><button class="workspace-switch" data-action="popover" data-popover="switcher" aria-haspopup="menu" aria-expanded="${ui.popover === 'switcher'}" title="切換餐車"><span class="workspace-avatar">${initial(name)}</span><span class="workspace-name"><strong>${esc(name)}</strong><small>${ui.accounts.length > 1 ? `切換餐車 · 已登入 ${ui.accounts.length} 台` : '切換或新增餐車'}</small></span><span class="workspace-chevron">${icon('swap', 13)}</span></button>${ui.popover === 'switcher' ? switcherPanel() : ''}</div>
    <div class="nav-label">品牌工作台</div><nav>${navs.map(([r, url, i, label]) => navLink(r, url, i, label, r === 'posts' ? drafts : 0)).join('')}<div class="nav-spacer"></div><div class="nav-label">餐車營運</div>${operations.map(([r, url, i, label]) => navLink(r, url, i, label, r === 'orders' ? newOrders : 0)).join('')}</nav>
    <div class="sidebar-foot">${navLink('settings', '/settings', 'settings', '工作區設定')}${navLink('guide', '/guide', 'book', '使用教學')}</div></aside>
    <div class="main-area"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="nav-open" aria-label="開啟導覽">${icon('menu', 19)}</button><span>${esc(s.brand.shortName)}</span>${icon('chevron', 11)}<strong>${titles[ui.route]}</strong></div>
    <div class="top-right"><span class="muted fine top-date">${dateLabel(new Date(), { year: 'numeric', weekday: 'long' })}</span>
      <div class="popover-wrap"><button class="icon-button bell-button" data-action="popover" data-popover="notify" aria-label="通知${unread ? `，${unread} 則未讀` : ''}" aria-expanded="${ui.popover === 'notify'}">${icon('bell', 18)}${unread ? `<span class="bell-count">${unread > 9 ? '9+' : unread}</span>` : ''}</button>${ui.popover === 'notify' ? notifyPopover(s) : ''}</div>
      <div class="popover-wrap"><button class="account-button" data-action="popover" data-popover="account" aria-label="帳號選單" aria-expanded="${ui.popover === 'account'}">${initial(name)}</button>${ui.popover === 'account' ? accountMenu() : ''}</div></div></header>
    <main class="content">${heading()}${content}<footer class="footer-note"><span>© 2026 BrandDNA 餐車工作台</span><span><a href="/guide">使用教學</a><span style="margin:0 7px;color:#c8d0c0">/</span><a href="/settings">工作區設定</a></span></footer></main></div></div>`;
}
export function stat(label, value, note, i) {
  return `<div class="stat"><span class="stat-icon">${icon(i, 17)}</span><div class="stat-label">${label}</div><div class="stat-number">${value}</div><div class="stat-note">${note}</div></div>`;
}
const fallbackImage = s => s.brand.coverImage || '/static/truck/brand/truck-official.webp';
export function postCard(p) {
  const s = getState();
  return `<article class="draft-card ${p.suggested ? 'suggested' : ''}" data-action="post-edit" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="編輯${esc(p.title)}"><div class="draft-image"><img src="${esc(p.meta?.image || p.image || fallbackImage(s))}" alt="貼文照片" loading="lazy" decoding="async">${postBadge(p, badge)}<span class="social-icon">${p.platform === 'instagram' ? '◎ Instagram' : 'f Facebook'}</span></div><div class="draft-body"><h3>${esc(p.title)}</h3><p>${esc(p.caption)}</p><div class="draft-foot"><span>${dateLabel(p.createdAt)} 建立${p.engine === 'ai' ? ' · AI' : ''}</span><span class="text-link">${p.status === 'draft' ? '確認草稿' : '查看內容'} ${arrow()}</span></div></div></article>`;
}
function assistantBanner(s, compact = false) {
  const post = s.posts.find(p => p.id === s.assistant?.suggestionPostId && p.status === 'draft');
  if (!post) return '';
  const days = s.assistant.idleDays || 3;
  if (compact) return `<div class="assistant-banner compact">${icon('bulb', 18)}<div><strong>已經 ${days} 天沒有發文了</strong><p>系統挑了「${esc(topicLabel(post.topicKey))}」主題，草稿已經準備好。</p></div>${btn('查看草稿', 'post-edit', 'primary small', `data-id="${esc(post.id)}"`)}</div>`;
  return `<section class="assistant-banner"><div class="assistant-copy"><span class="eyebrow">POSTING REMINDER</span><h2>已經 ${days} 天沒有發文或排程了</h2><p>系統挑了比較久沒輪到的「${esc(topicLabel(post.topicKey))}」，先幫你寫好草稿${post.engine === 'ai' ? '（AI 依品牌語氣撰寫）' : ''}。看過、改一下，確認後就能發布或排程。</p>
    <div class="actions">${btn(`${icon('check', 14)} 查看並確認`, 'post-edit', 'primary', `data-id="${esc(post.id)}"`)}${btn(`${icon('refresh', 13)} 換一個主題`, 'assistant-retry', '')}${btn('先不用', 'assistant-dismiss', '')}</div></div>
    <div class="assistant-draft" data-action="post-edit" data-id="${esc(post.id)}" role="button" tabindex="0"><img src="${esc(post.image || fallbackImage(s))}" alt=""><div><span class="badge draft">${esc(topicLabel(post.topicKey))}</span><h3>${esc(post.title)}</h3><p>${esc(post.caption)}</p></div></div></section>`;
}
function onboarding(s) {
  const steps = [
    ['menu', '/menu', '建立菜單', s.menu.length > 0, '新增餐點、價格與照片'],
    ['data', '/data-hub', '補充品牌資料', s.sources.length > 0, '品牌故事、社群貼文或官網'],
    ['dna', '/diagnosis', '建立 Brand DNA', s.diagnosis.status === 'ready', '整理定位、語氣與客群'],
    ['calendar', '/calendar', '安排第一場出攤', s.stalls.length > 0, '顧客點餐頁會顯示地點'],
    ['qr', '/orders', '下載點餐 QR Code', s.orders.length > 0, '貼在餐車上讓顧客掃碼'],
  ];
  if (steps.every(step => step[3])) return '';
  const done = steps.filter(step => step[3]).length;
  return `<section class="panel onboarding"><div class="panel-head"><div><span class="eyebrow muted">GET STARTED</span><h2>開始設定 ${esc(s.brand.shortName)}（${done}/${steps.length}）</h2></div><a class="text-link" href="/guide">${icon('book', 13)} 看使用教學</a></div>
    <div class="onboarding-steps">${steps.map(([key, url, label, ok, note], index) => `<a class="onboarding-step ${ok ? 'done' : ''}" href="${url}"><span class="step-dot">${ok ? icon('check', 12) : index + 1}</span><span><strong>${label}</strong><small>${note}</small></span></a>`).join('')}</div></section>`;
}
export function dashboard() {
  const s = getState(),
    pending = s.posts.filter(p => p.status === 'draft'),
    scheduled = s.posts.filter(p => p.status === 'scheduled'),
    today = taipeiToday(),
    todayOrders = s.orders.filter(o => o.status !== 'cancelled' && new Date(Date.parse(o.createdAt) + 8 * 3600000).toISOString().slice(0, 10) === today),
    overdue = scheduled.filter(p => isOverdue(p)),
    weekMembers = s.members.filter(m => (daysAgo(m.createdAt) ?? 99) < 7).length;
  const next = [...s.stalls].filter(e => e.date >= today).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))[0];
  const top = [...s.archetypes].sort((a, b) => b.score - a.score)[0];
  const analyzed = s.sources.filter(x => x.status === 'analyzed').length;
  const nowIso = new Date().toISOString();
  const nextPost = [...scheduled].filter(p => String(p.scheduledAt) > nowIso).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0];
  const completedToday = todayOrders.filter(o => o.status === 'completed');
  const cover = s.brand.coverImage;
  const flow = [['整理資料', '/data-hub', analyzed > 0], ['品牌診斷', '/diagnosis', s.diagnosis.status === 'ready'], ['產生貼文', '/generate', s.posts.some(p => p.status !== 'draft')], ['確認排程', '/calendar', scheduled.length > 0]];
  const current = flow.findIndex(step => !step[2]);
  return `${onboarding(s)}${assistantBanner(s, true)}<div class="stats">${stat('今日訂單', todayOrders.length, `已完成營收 ${money(completedToday.reduce((sum, o) => sum + Number(o.total || 0), 0))}`, 'shopping-bag')}${stat('待確認草稿', pending.length, '確認後才能發布或排程', 'pen')}${stat('已排程貼文', scheduled.length, overdue.length ? `<span class="warn-text">${overdue.length} 則時間已過、尚未發布</span>` : nextPost ? `下一則 ${dateLabel(nextPost.scheduledAt, { hour: '2-digit', minute: '2-digit' })}` : '目前沒有排程', 'calendar')}${stat('會員', s.members.length, `本週新增 ${weekMembers} 位`, 'users')}</div>
  <div class="hero-grid"><section class="hero ${cover ? '' : 'no-photo'}">${cover ? `<img class="hero-photo" src="${esc(cover)}" fetchpriority="high" alt="${esc(s.brand.name)}">` : ''}<div><span class="eyebrow">NEXT POST</span><h2>要出車了嗎？<br>先發一則預告。</h2><p>出車前一天貼出時間和地點，<br>想來的人比較好安排。</p>${btn(`寫出車預告 ${arrow()}`, 'post-new', '', 'data-topic="本週出車預告：時間、地點與預訂方式" data-key="stall"')}</div><span class="hero-label">${esc(s.brand.name)}</span></section>
  <section class="stall-card"><div class="stall-top"><strong>下一場出車</strong><span class="badge neutral">${next ? (next.date === today ? '今天' : dateLabel(next.date)) : '未安排'}</span></div>${next ? `<div class="stall-date"><div class="date-box"><strong>${new Date(next.date + 'T12:00:00').getDate()}</strong><small>${dateLabel(next.date, { month: 'short' })}</small></div><div><div class="stall-name">${esc(next.title)}</div><div class="info">${icon('clock', 12)}${esc(next.start)} – ${esc(next.end)}</div><div class="info">${icon('map-pin', 12)}${esc(next.location)}</div></div></div><div class="stall-bottom"><span>記得提前發預告</span><a href="/calendar">查看行事曆 ${arrow()}</a></div>` : `<div class="empty" style="padding:24px 10px">還沒有安排出車<p><a class="text-link" href="/calendar">前往新增 ${arrow()}</a></p></div>`}</section></div>
  <div class="workflow"><span class="workflow-label">操作流程</span>${flow.map(([label, url, ok], i) => `<a class="workflow-step ${i === current ? 'current' : ''}" href="${url}"><span class="step-dot">${ok ? icon('check', 12) : i + 1}</span>${label}${i < 3 ? `<span class="workflow-chevron">${icon('chevron', 11)}</span>` : ''}</a>`).join('')}</div>
  <div class="grid cols-main dashboard-lower"><section class="panel"><div class="panel-head"><div><span class="eyebrow">DRAFTS</span><h2>待確認的貼文 <span class="badge draft">${pending.length} 則</span></h2></div><a class="text-link" href="/generate">全部貼文 ${arrow()}</a></div>${pending.length ? `<div class="draft-grid">${pending.slice(0, 2).map(postCard).join('')}</div>` : empty('目前沒有待確認的草稿', '可以到貼文工作區產生新的草稿。', 'post-new', '新增貼文')}</section>
  <section class="panel"><div class="panel-head"><h2>品牌人格</h2><a href="/diagnosis" class="text-link" aria-label="查看品牌診斷">${arrow()}</a></div>${s.diagnosis.status === 'ready' ? `<div class="dna-summary"><img class="dna-symbol" src="/static/archetypes/${esc(top?.id || 'caregiver')}.svg" alt="品牌人格插畫"><div><small>BRAND ARCHETYPE</small><strong>${esc(top?.label || '')}</strong><div class="tags">${(s.diagnosis.tone || []).slice(0, 3).map(t => libTag(t, 'tone')).join('')}</div></div></div><p class="brand-description">${esc(s.diagnosis.positioning)}</p>` : `<p class="body-copy">還沒有建立 Brand DNA。先到資料中心補充品牌介紹，再到品牌診斷建立。</p>`}<div class="source-progress"><span>來源分析進度</span><strong>${analyzed} / ${s.sources.length} 已分析</strong></div><div class="progress-track"><span style="width:${s.sources.length ? (analyzed / s.sources.length) * 100 : 0}%"></span></div><div style="margin-top:12px"><a class="text-link" href="/data-hub">補充品牌資料 ${arrow()}</a></div></section></div>
  <div class="grid cols-2 section-space"><section class="panel"><div class="panel-head"><h2>近期行程</h2><a class="text-link" href="/calendar">查看日曆 ${arrow()}</a></div>${[...s.stalls.filter(e => e.date >= today).slice(0, 2).map(e => ({ icon: 'truck', title: e.title, date: e.date, detail: `${e.start} · ${e.location}`, type: '出攤' })), ...scheduled.slice(0, 2).map(p => ({ icon: 'pen', title: p.title, date: p.scheduledAt, detail: p.platform === 'instagram' ? 'Instagram 貼文' : 'Facebook 貼文', type: p.meta ? 'Meta 排程' : '排程貼文' }))].map(e => `<div class="row-item"><span class="row-icon">${icon(e.icon, 16)}</span><div class="row-main"><strong>${esc(e.title)}</strong><p>${dateLabel(e.date)} · ${esc(e.detail)}</p></div><span class="badge neutral">${e.type}</span></div>`).join('') || '<p class="body-copy">還沒有安排行程。</p>'}</section>
  <section class="panel activity-feed"><div class="panel-head"><h2>最近動態</h2><span class="eyebrow">ACTIVITY</span></div>${s.activity.slice(0, 4).map(a => `<div class="row-item"><span class="row-icon">${icon(a.type?.includes('order') ? 'shopping-bag' : a.type === 'assistant' ? 'bulb' : a.type === 'campaign' ? 'send' : 'check', 14)}</span><div class="row-main"><strong>${esc(a.text)}</strong><p>${dateLabel(a.date, { hour: '2-digit', minute: '2-digit' })}</p></div></div>`).join('') || '<p class="body-copy">還沒有操作紀錄。</p>'}</section></div>`;
}
export function sourceLabel(type) {
  return Object.fromEntries([...SOURCE_TYPES, ['official', '官方介紹'], ['text', '文字檔案'], ['image', '圖片素材']])[type] || type;
}
export function dataView() {
  const s = getState(),
    analyzed = s.sources.filter(x => x.status === 'analyzed').length;
  return `<div class="grid cols-3" style="margin-bottom:20px">${stat('品牌資料', s.sources.length, '品牌介紹、社群、匯入與成效', 'database')}${stat('已分析', analyzed, '會納入品牌診斷', 'check')}${stat('待分析', s.sources.length - analyzed, '可單筆或一次全部分析', 'clock')}</div>${importPanel()}<div class="panel section-space"><div class="panel-head"><h2>品牌資料庫 <span class="badge neutral">${s.sources.length} 筆來源</span></h2><div class="actions">${btn('分析全部來源', 'sources-analyze', 'soft')}<a class="btn primary" href="/diagnosis">查看品牌診斷 ${arrow()}</a></div></div>${s.sources.length ? `<div class="wide-table"><table class="source-table"><thead><tr><th>資料名稱</th><th>來源類型</th><th>建立日期</th><th>處理進度</th><th>操作</th></tr></thead><tbody>${s.sources.map(x => `<tr class="${ui.highlightSource === x.id ? 'highlight' : ''}" id="source-${esc(x.id)}"><td><div class="source-title"><span class="row-icon">${icon(x.type === 'performance' ? 'chart' : x.type === 'image' ? 'image' : 'database', 15)}</span><span><strong>${esc(x.title)}</strong><small>${esc(x.content)}</small></span></div></td><td>${esc(x.mode === 'meta' ? 'Meta 成效回饋' : sourceLabel(x.type))}</td><td class="muted">${dateLabel(x.updatedAt || x.createdAt)}</td><td>${badge(x.status)}</td><td><div class="actions">${btn(`${icon('pen', 12)}<span class="label">編輯</span>`, 'source-edit', 'small', `data-id="${esc(x.id)}" aria-label="編輯 ${esc(x.title)}"`)}${btn(`${icon('trash', 12)}<span class="label">刪除</span>`, 'source-delete-ask', 'small danger', `data-id="${esc(x.id)}" aria-label="刪除 ${esc(x.title)}"`)}${x.status !== 'analyzed' ? btn('分析', 'source-analyze', 'small soft', `data-id="${esc(x.id)}"`) : ''}</div></td></tr>`).join('')}</tbody></table></div>` : empty('還沒有品牌資料', '用上方的「新增品牌資料」加入品牌故事、社群貼文或官網內容，品牌診斷會從這些資料整理。', '', '')}</div>${metaImportPanel(s)}`;
}
export function diagnosisView() {
  const s = getState(),
    a = [...s.archetypes].sort((a, b) => b.score - a.score),
    top = a[0],
    d = s.diagnosis;
  if (d.status !== 'ready') {
    return `<section class="panel">${empty('還沒有建立 Brand DNA', s.sources.length ? '資料中心已經有資料了，按右上角「重新建立 Brand DNA」開始診斷。' : '先到資料中心新增品牌故事、社群貼文或官網內容，再回來建立。', s.sources.length ? 'diagnosis-run' : 'source-new', s.sources.length ? '建立 Brand DNA' : '新增品牌資料')}</section>`;
  }
  const card = (i, title, body) => `<section class="panel dna-card"><div class="panel-head"><h2>${icon(i, 16)} ${title}</h2></div>${body}</section>`;
  const archetype = (x, i) => `<div class="archetype ${i < 2 ? 'top' : ''}"><img src="/static/archetypes/${esc(x.id)}.svg" alt=""><h3>${i + 1}. ${esc(x.label)}</h3><div class="score">${x.score}<span style="font-size:10px"> 分</span></div><div class="progress-track" style="margin-bottom:11px"><span style="width:${Math.min(100, Math.max(0, x.score))}%"></span></div><p>${esc(x.description)}</p></div>`;
  const advantages = (d.comparison || []).filter(row => row.verdict === 'advantage');
  const audiences = d.audiences?.length ? d.audiences : d.audience.map(label => ({ label, situation: '' }));
  return `${info(d.engine === 'ai' ? 'Brand DNA 由 AI 依資料中心的內容整理，人格分數僅供參考。' : '分數依資料中心內容的關鍵字估算，僅供參考；啟用 AI 助理後會改由 AI 分析。', true)}<div class="dna-hero"><img src="/static/archetypes/${esc(top.id)}.svg" alt="${esc(top.label)}"><div><span class="eyebrow" style="color:#8da37e">BRAND ARCHETYPE</span><h2>${esc(s.brand.shortName)}的主要人格：${esc(top.label)}</h2><p>${esc(d.summary)}</p><div class="tags"><span class="badge approved">${d.engine === 'ai' ? 'AI 分析' : '規則分析'}</span><span class="tag">${dateLabel(d.generatedAt)} 建立</span></div></div></div>
  <div class="dna-dimensions">${card('map-pin', '品牌定位', `<p class="body-copy">${esc(d.positioning)}</p>`)}${card('pen', '溝通語氣', `<div class="tags">${d.tone.map(t => libTag(t, 'tone')).join('')}</div><p class="fine muted lib-hint">滑過（手機點一下）語氣，看定義與範例</p><p class="body-copy" style="margin-top:8px">${esc(d.toneNote)}</p>`)}${card('users', '核心客群', `${audiences.map(a => `<div class="audience-row">${libTag(a.label, 'audience')}${a.situation ? `<p>${esc(a.situation)}</p>` : ''}</div>`).join('')}<p class="fine muted lib-hint">滑過客群，看定義與典型情境</p>`)}${card('star', '差異化優勢', d.comparison?.length ? `${advantages.length ? advantages.map(row => `<p class="body-copy dot-line"><strong>${esc(row.label)}</strong>：${esc(row.store)}</p>`).join('') : '<p class="body-copy">目前沒有明顯優於一般餐車的項目，可以看下方比較表找出可以加強的地方。</p>'}<a class="text-link" href="#comparison">看完整比較 ${arrow()}</a>` : d.differentiation.length ? d.differentiation.map(t => `<p class="body-copy dot-line">${esc(t)}</p>`).join('') : '<p class="body-copy">補充品牌資料後重新診斷。</p>')}${card('grid', '內容主軸', d.pillars.length ? `${d.pillars.map(p => `<div class="pillar"><strong>${esc(p.title)}</strong><p>${esc(p.detail)}</p></div>`).join('')}<a class="text-link" href="/generate">用內容主軸發文 ${arrow()}</a>` : '<p class="body-copy">補充品牌資料後重新診斷。</p>')}</div>
  ${comparisonPanel(d)}
  <div class="panel-head section-space"><h2>品牌人格前五名</h2><span class="muted fine">共 12 種人格</span></div><div class="archetype-grid top-five">${a.slice(0, 5).map(archetype).join('')}</div>
  <details class="fold archetype-more"><summary>${icon('down', 13)} 查看其他 ${a.length - 5} 種人格</summary><div class="archetype-grid">${a.slice(5).map((x, i) => archetype(x, i + 5)).join('')}</div></details>
  <div class="grid cols-2 section-space"><section class="panel"><div class="panel-head"><h2>參考來源</h2><a class="text-link" href="/data-hub">查看來源 ${arrow()}</a></div>${s.sources.filter(x => x.status === 'analyzed').slice(0, 3).map(x => `<div class="row-item"><span class="row-icon">${icon(x.type === 'performance' ? 'chart' : 'database', 15)}</span><div class="row-main"><strong>${esc(x.title)}</strong><p>${esc(x.content.slice(0, 80))}…</p></div></div>`).join('') || '<p class="body-copy">還沒有已分析的來源。</p>'}</section><section class="panel"><div class="panel-head"><h2>套用到貼文</h2></div><p class="body-copy">產生貼文草稿時會套用這裡的五大面向。草稿還是要店家自己看過、修改、確認，才會發布。</p><div class="actions" style="margin-top:20px">${btn(`${icon('pen', 14)}建立貼文`, 'post-new', 'primary')}<a class="btn" href="/data-hub">補充品牌資料</a></div>${d.feedbackAt ? `<p class="fine muted" style="margin-top:16px">${dateLabel(d.feedbackAt)} 已加入貼文成效。</p>` : ''}</section></div>`;
}
export function postsView() {
  const s = getState(),
    list = s.posts.filter(p => ui.postFilter === 'all' || p.status === ui.postFilter);
  return `${assistantBanner(s)}${quickStart(s)}<div class="list-filters section-space">${[['all', '全部貼文'], ['draft', '待確認'], ['approved', '已確認'], ['scheduled', '已排程'], ['published', '已發布']].map(([key, label]) => `<button class="filter-btn ${ui.postFilter === key ? 'active' : ''}" data-action="post-filter" data-filter="${key}">${label} <small>${key === 'all' ? s.posts.length : s.posts.filter(p => p.status === key).length}</small></button>`).join('')}</div>${list.length ? `<div class="draft-grid all">${list.map(postCard).join('')}</div>` : `<section class="panel">${empty('這個分類沒有貼文', '可以建立新貼文，或切換到其他分類。', 'post-new', '新增貼文')}</section>`}`;
}
export function pageHtml() {
  const s = getState();
  const renderers = { dashboard, data: dataView, diagnosis: diagnosisView, posts: postsView, members: () => membersView(s), menu: () => menuView(s), guide: () => guideView(s) };
  const content = renderers[ui.route] ? renderers[ui.route]() : renderSecondary(ui.route, s, { icon, esc, money, dateLabel, badge });
  return shell(content || '');
}
