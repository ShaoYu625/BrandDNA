let state;
const listeners = new Set();
let pending = Promise.resolve();

// Realtime first: one hibernatable WebSocket per page. Polling with ?since= (204 when unchanged) only runs while the socket is down.
const REQUEST_TIMEOUT = 15000;
const UPLOAD_TIMEOUT = 60000;
/** Actions that may call the LLM, fetch a web page or read an image on the server. */
const SLOW_ACTIONS = new Set(['post.generate', 'diagnosis.run', 'assistant.check', 'trends.refresh', 'menu.translate', 'source.import']);
/** view: merchant | public. truck: the customer page's truck slug. workspace: the merchant tab's truck slug. */
let config = { view: 'merchant', order: null, member: null, truck: null, workspace: null };
let realtimeUrl = null;
let socket = null;
let socketOpen = false;
let reconnectDelay = 1000;
let reconnectTimer;
let heartbeat;
let pollTimer;
let pollMs = 15000;
let pollFailures = 0;
let started = false;

export const getState = () => state;
/** Short two-tone chime (no audio file). Browsers allow sound only after a tap, so pages call unlock() from a tap first. */
let audioContext = null;
export const sound = {
  unlock() {
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return;
      audioContext ||= new Context();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch { /* sound stays off */ }
  },
  chime(times = 1) {
    if (!audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime + 0.02;
    for (let round = 0; round < times; round++) {
      [880, 1318].forEach((frequency, index) => {
        const at = start + round * 0.7 + index * 0.18;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.45);
      });
    }
  },
};
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = value => `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;
function receive(next) {
  if (!next || (state && next.revision < state.revision)) return;
  // A customer view can change without a new revision (e.g. after subscribing to a new order).
  const changed = !state || next.revision !== state.revision || (config.view === 'public' && JSON.stringify(next) !== JSON.stringify(state));
  state = next;
  if (changed) listeners.forEach(fn => fn(state));
}
async function request(path, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  let res;
  const headers = { ...(options.headers || {}) };
  if (config.view === 'merchant' && config.workspace) headers['X-Truck-Workspace'] = config.workspace;
  try {
    res = await fetch(`/api/truck/${path}`, {cache:'no-store',...options,headers,...(controller ? {signal:controller.signal} : {})});
  } catch (failure) {
    const error = new Error(failure?.name === 'AbortError' ? '連線逾時，請確認網路後再試一次。' : '網路連線中斷，請確認網路後再試一次。');
    error.network = true;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 204) return { success: true, unchanged: true };
  const data = await res.json().catch(() => { throw new Error('服務暫時無法回應，請稍後再試。'); });
  if (!res.ok || data.success === false) {
    const error = new Error(data.error || '操作未完成，請稍後再試。');
    error.status = res.status;
    if (res.status === 401 && config.view === 'merchant' && !path.startsWith('session') && path !== 'register' && !path.startsWith('account/') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('truck-session-expired'));
    }
    throw error;
  }
  if (data.realtime) realtimeUrl = data.realtime;
  if (data.state) receive(data.state);
  return data;
}
function query(extra = {}) {
  const params = new URLSearchParams();
  if (config.view === 'public') {
    if (config.truck) params.set('truck', config.truck);
    if (config.order) params.set('order', config.order);
    if (config.member) params.set('member', config.member);
  }
  for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== null) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}
const statePath = since => `${config.view === 'public' ? 'public' : 'state'}${query({ since })}`;
const actionPath = () => `${config.view === 'public' ? 'public/actions' : 'actions'}${query()}`;

/** options: { view: 'merchant' | 'public', order, member, pollMs } */
export async function init(options = {}) {
  config = { ...config, ...options };
  if (options.pollMs) pollMs = options.pollMs;
  await request(statePath());
  if (typeof window !== 'undefined' && !started) {
    started = true;
    connect();
    schedulePoll();
    const wake = () => { if (document.visibilityState !== 'visible') return; if (!socketOpen) { refresh(); connect(); } };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
  }
  return state;
}
export function refresh() { return request(statePath(state?.revision)).catch(() => {}); }
/** Fallback polling interval while the realtime socket is unavailable. */
export function setPollInterval(ms) { pollMs = ms; if (started) schedulePoll(); }
/** Customer pages follow their own order/member; the server then pushes only that view. */
export function setSubscription(ids) {
  config = { ...config, ...ids };
  if (socket && socketOpen) socket.send(JSON.stringify({ type: 'subscribe', order: config.order || '', member: config.member || '' }));
}
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, pollMs * Math.min(8, 2 ** pollFailures));
}
async function poll() {
  if (document.visibilityState === 'visible' && !socketOpen) {
    try { await request(statePath(state?.revision)); pollFailures = 0; } catch { pollFailures++; }
  }
  schedulePoll();
}
function connect() {
  if (!realtimeUrl || typeof WebSocket !== 'function' || socket) return;
  const url = new URL(realtimeUrl);
  url.search = query({ view: config.view, workspace: config.view === 'merchant' ? config.workspace : null });
  let ws;
  try { ws = new WebSocket(url); } catch { return; }
  socket = ws;
  ws.addEventListener('open', () => {
    socketOpen = true;
    reconnectDelay = 1000;
    clearInterval(heartbeat);
    // Answered by the runtime's auto-response, so heartbeats never wake the Durable Object.
    heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 50000);
  });
  ws.addEventListener('message', event => {
    if (event.data === 'pong') return;
    try { const data = JSON.parse(event.data); if (data.type === 'state') receive(data.state); } catch { /* ignore malformed frames */ }
  });
  ws.addEventListener('close', () => {
    if (socket === ws) { socket = null; socketOpen = false; clearInterval(heartbeat); }
    clearTimeout(reconnectTimer);
    if (document.visibilityState !== 'visible') return;
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(30000, reconnectDelay * 2);
  });
  ws.addEventListener('error', () => ws.close());
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function newKey() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}
/** Actions run one at a time; a network failure is retried once with the same idempotency key, so it can never apply twice. */
export function dispatch(type, payload = {}) {
  const key = newKey();
  const timeout = SLOW_ACTIONS.has(type) ? 70000 : REQUEST_TIMEOUT;
  const send = () => request(actionPath(), {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({type,payload})}, timeout);
  const action = () => send().catch(error => {
    if (!error.network) throw error;
    return new Promise(resolve => setTimeout(resolve, 800)).then(send);
  });
  const result = pending.then(action, action);
  pending = result.catch(() => {});
  return result;
}

export const metaRequest = (path, payload) => request(`meta/${path}`, payload === undefined ? {} : {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
}, 60000);
/** Read-only customer request (e.g. checking a discount code); never changes the shared state. */
export async function publicCheck(type, payload = {}) {
  return (await request(actionPath(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload }) })).result;
}
const jsonPost = (path, body, method = 'POST') => request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/** Merchant accounts: one truck = one account. Signed-in trucks of this browser can be switched without a password. */
export const account = {
  session: () => request('session'),
  login: (username, password) => jsonPost('session', { username, password }),
  register: details => jsonPost('register', details),
  switchTo: slug => jsonPost('session/switch', { slug }),
  logout: (all = false) => request(`session${all ? '?all=1' : ''}`, { method: 'DELETE' }),
  changePassword: (current, next) => jsonPost('account/password', { current, next }),
};
export function setWorkspace(slug) { config = { ...config, workspace: slug || null }; }
export const workspaceSlug = () => config.workspace;
export const aiStatus = () => request('ai/status');
export const aiCopy = body => jsonPost('ai/copy', body);
export async function uploadPublicationJpeg(blob) {
  if (blob.type !== 'image/jpeg' || blob.size > MAX_UPLOAD) throw new Error('發布圖須為 5 MB 以內的 JPEG。');
  const body = new FormData();
  body.append('file', blob, 'publication.jpg');
  return (await request('photo?publish=1', { method: 'POST', body }, UPLOAD_TIMEOUT)).url;
}

const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_ORIGINAL = 25 * 1024 * 1024;
const MAX_EDGE = 1600;
/** Phone photos are resized to 1600px and re-encoded as WebP (JPEG fallback) before upload: faster on mobile, fewer stored chunks. */
export async function prepareImage(file) {
  if (file.size <= 300 * 1024 || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
    let blob = await encode('image/webp', 0.82);
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.85);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
  } catch {
    return file;
  }
}
export async function uploadPhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('請選擇 JPG、PNG 或 WebP 照片。');
  if (file.size > MAX_ORIGINAL) throw new Error('照片上限為 25 MB（上傳前會自動壓縮）。');
  const prepared = await prepareImage(file);
  if (prepared.size > MAX_UPLOAD) throw new Error('照片壓縮後仍超過 5 MB，請換一張照片。');
  const body = new FormData(); body.append('file',prepared);
  return (await request('photo',{method:'POST',body},UPLOAD_TIMEOUT)).url;
}
const shapes = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  dna:'<path d="M7 3c0 9 10 9 10 18M17 3c0 9-10 9-10 18M7 4h10M8 8h8M8 16h8M7 20h10"/>',
  pen:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>',
  chart:'<path d="M4 3v18h17M8 16l4-5 4 2 5-7"/>',
  'shopping-bag':'<path d="M5 7h14l2 14H3zM9 8V6a3 3 0 0 1 6 0v2"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings:'<path d="m9 3-1 3-3 1-2 4 2 3v4l4 2 3-1 3 1 4-2v-4l2-3-2-4-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>', 'arrow-left':'<path d="M20 12H4m6-6-6 6 6 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  truck:'<path d="M2 5h13v12H2zM15 9h4l3 4v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  'map-pin':'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  leaf:'<path d="M20 3C9 2 3 8 5 15s17 4 15-12ZM5 20 16 9"/>',
  heart:'<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-6 6 8 16 8 16S26 11 20 5Z"/>',
  'external-link':'<path d="M14 3h7v7M21 3l-9 9M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m6 9 6 6 6-6"/>',
  sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21h4"/>',
  search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 4 3-3 5 5"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',eye:'<path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
  shield:'<path d="m12 2 9 4v7c0 5-9 9-9 9s-9-4-9-9V6z"/><path d="m8 12 3 3 5-6"/>',
  logout:'<path d="M10 3H3v18h7M9 12h13m-5-5 5 5-5 5"/>',
  link:'<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',refresh:'<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>',
  gift:'<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8Zm0 0s2-5 4.5-3.5S15 8 12 8Z"/>',
  tag:'<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 20h16"/>',copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3"/><path d="M20 4v15h-7"/>',
  trending:'<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  'arrow-up':'<path d="M12 20V4m-6 6 6-6 6 6"/>','arrow-down':'<path d="M12 4v16m-6-6 6 6 6-6"/>',
  qr:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  bulb:'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3Z"/>',
  swap:'<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  ban:'<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>'
};
export const icon = (name,size=20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]||shapes.sparkles}</svg>`;
