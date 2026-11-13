// Shared merchant UI state and small HTML helpers.
import { esc, icon, workspaceSlug } from './client.mjs';

export const statusNames = {
  draft: '待確認',
  approved: '已確認',
  scheduled: '已排程',
  published: '已發布',
  ready: '待分析',
  analyzed: '已分析',
};
export const routes = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/data-hub': 'data',
  '/sources': 'data',
  '/diagnosis': 'diagnosis',
  '/generate': 'posts',
  '/posts': 'posts',
  '/calendar': 'calendar',
  '/orders': 'orders',
  '/menu': 'menu',
  '/analytics': 'analytics',
  '/members': 'members',
  '/settings': 'settings',
  '/guide': 'guide',
  '/gatekeeper': 'settings',
  '/simulation': 'analytics',
};
export const titles = {
  dashboard: '商家總覽',
  data: '資料中心',
  diagnosis: '品牌診斷',
  posts: '貼文工作區',
  calendar: '行事曆與發文',
  orders: '訂單管理',
  menu: '菜單管理',
  analytics: '貼文成效',
  members: '會員管理',
  settings: '工作區設定',
  guide: '使用教學',
};
/** Content rotation (mirrors the server's TOPICS). */
export const TOPICS = [
  { key: 'stall', label: '出車預告', topic: '本週出車預告：時間、地點與預訂方式' },
  { key: 'signature', label: '招牌菜推薦', topic: '推薦一道招牌菜' },
  { key: 'team', label: '夥伴日常', topic: '夥伴備餐的日常' },
  { key: 'thanks', label: '顧客感謝', topic: '謝謝來吃的大家' },
  { key: 'offer', label: '會員優惠', topic: '會員專屬優惠活動' },
  { key: 'behind', label: '食材與備料', topic: '今天的食材與備料' },
  { key: 'story', label: '品牌故事', topic: '我們為什麼開這台餐車' },
  { key: 'seasonal', label: '季節限定', topic: '季節限定的暖心餐點' },
];
/** Quick-start categories outside the rotation (mirrors the server's EXTRA_TOPIC_KEYS). */
const EXTRA_TOPICS = { pillar: '內容主軸', trend: '今日趨勢', season: '季節性' };
export const topicLabel = key => TOPICS.find(entry => entry.key === key)?.label || EXTRA_TOPICS[key] || '自訂主題';

/** Mutable UI state shared by the controller, views and modals. */
export const ui = {
  route: routes[location.pathname.replace(/\/$/, '') || '/'] || 'dashboard',
  postFilter: 'all', editorImage: '', popover: null, notifyTab: 'all',
  memberSegment: 'all', memberSort: { key: 'last', dir: 'desc' }, menuCategory: '全部',
  highlightSource: null, ai: null, accounts: [], account: null,
};
let toastTimer;
export const dateLabel = (v, options = {}) =>
  v
    ? new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei', ...options }).format(
        new Date(String(v).length === 10 ? `${v}T12:00:00+08:00` : v),
      )
    : '尚未設定';
export function taipeiToday(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
export const daysAgo = value => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 86400000)) : null;
};
export const badge = s => `<span class="badge ${esc(s)}">${esc(statusNames[s] || s)}</span>`;
export const arrow = () => icon('arrow-right', 13);
export const btn = (text, action, cls = '', extra = '') =>
  `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${text}</button>`;
export const empty = (heading, desc, action = 'post-new', label = '新增貼文') =>
  `<div class="empty">${icon('leaf', 30)}<h3>${heading}</h3><p>${desc}</p>${action ? btn(label, action, 'soft') : ''}</div>`;
export const info = (text, sea = false) => `<div class="notice ${sea ? 'sea' : ''}">${icon('leaf', 16)}<span>${text}</span></div>`;
export function toast(message, error = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 4500);
}
/** Customer ordering link for the current truck. */
export const orderUrl = () => `${location.origin}/order?truck=${encodeURIComponent(workspaceSlug() || 'haihai')}`;
export const orderPath = () => `/order?truck=${encodeURIComponent(workspaceSlug() || 'haihai')}`;
/** Per-truck browser preferences (notification read state, guide progress). */
export function store(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`branddna.truck.${workspaceSlug() || 'haihai'}.${key}`)) ?? fallback; } catch { return fallback; }
}
export function remember(key, value) {
  try { localStorage.setItem(`branddna.truck.${workspaceSlug() || 'haihai'}.${key}`, JSON.stringify(value)); } catch { /* private mode keeps working */ }
}
export async function copyText(value) {
  try { await navigator.clipboard.writeText(value); toast('已複製。'); }
  catch { toast('無法自動複製，請手動選取文字複製。', true); }
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const initial = name => esc(String(name || '餐').trim().slice(0, 1));
export function logo() {
  return `<svg class="logo-mark" viewBox="0 0 32 35" fill="none" aria-hidden="true"><path d="M9 3c0 12 14 12 14 29M23 3C23 15 9 15 9 32" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M11 7h10M13 12h6M13 23h6M11 28h10" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><circle cx="25" cy="3" r="2" fill="#dda466"/></svg>`;
}
