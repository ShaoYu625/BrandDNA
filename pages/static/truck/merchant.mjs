import { init, getState, dispatch, subscribe, esc, icon, money, sound, uploadPhoto, metaRequest, uploadPublicationJpeg, account, setWorkspace, aiStatus, aiCopy } from './client.mjs';
import { platformLabel, refreshMeta, publicationJpeg } from './merchant-meta.mjs';
import { shiftCalendar, shortOrderNumber, CANCEL_REASONS } from './secondary.mjs';
import { ui, routes, btn, toast, store, remember, copyText, downloadBlob, orderUrl, taipeiToday } from './merchant-ui.mjs';
import { pageHtml } from './merchant-views.mjs';
import { authScreen, rememberAccount, forgetAccount, savedPassword, forgetPassword } from './merchant-auth.mjs';
import { findNotification, markRead, notifications } from './merchant-notify.mjs';
import { campaignModal, syncCampaignForm, campaignPayload, campaignCopyInput, couponModal, couponPayload, syncCouponForm, memberDetail } from './merchant-members.mjs';
import { menuModal, menuPayload } from './merchant-menu.mjs';
import { fillQR, downloadAsset } from './merchant-assets.mjs';
import {
  modalRoot, openModal, closeModal, modalError, confirmModal, newSource, newPost, postEditor, saveEditor,
  showPublicationPreview, getPublicationPreview, scheduleModal, stallModal, metricsModal, publishModal, brandModal, passwordModal, memberSettingsModal, labelModal,
} from './merchant-modals.mjs';
import { labelField, chosenLabel, allLabels } from './merchant-labels.mjs';
import { splitBatch, draft, resetDraft, readHtmlFiles, readTextFiles } from './merchant-import.mjs';

const app = document.getElementById('app');
const TAB_KEY = 'branddna.truck.tab';
const ORDER_STATUS_TEXT = { new: '新訂單', accepted: '已接單', preparing: '製作中', ready: '可取餐', completed: '已完成', cancelled: '已取消' };
// While someone is typing, a pushed update is deferred (not dropped) and applied as soon as focus leaves the field.
let deferredRender = false;
let authMode = null;
/** The username/password pair the login form was filled with from this device (to detect a stale saved password). */
let filledLogin = null;
let trendsRequested = false;

const tabSlug = () => { try { return sessionStorage.getItem(TAB_KEY); } catch { return null; } };
const setTabSlug = slug => { try { slug ? sessionStorage.setItem(TAB_KEY, slug) : sessionStorage.removeItem(TAB_KEY); } catch { /* private mode */ } };

function showAuth(mode, options = {}) {
  authMode = mode;
  closeModal();
  const params = new URLSearchParams(location.search);
  const adding = options.adding ?? params.get('add') === '1';
  const path = mode === 'register' ? '/register' : '/login';
  if (location.pathname !== path) history.pushState({}, '', `${path}${adding ? '?add=1' : ''}`);
  document.title = mode === 'register' ? 'BrandDNA｜註冊新餐車' : 'BrandDNA｜登入餐車工作台';
  app.innerHTML = authScreen(mode, { signedIn: ui.accounts, adding, prefill: options.prefill || '', error: options.error || '' });
  // A password remembered on this device is filled in by script (never written into the HTML).
  filledLogin = null;
  const field = app.querySelector('#login-password');
  if (field && options.prefill && options.password) {
    field.value = options.password;
    filledLogin = { username: options.prefill, password: options.password };
    const hint = app.querySelector('#login-saved-hint');
    hint.hidden = false;
    field.addEventListener('input', () => { hint.hidden = true; }, { once: true });
  }
  setTimeout(() => app.querySelector(filledLogin ? '.auth-submit' : options.prefill ? '#login-password' : 'input')?.focus(), 0);
}

function render(force = false) {
  const s = getState();
  if (!s || authMode) return;
  if (!force && document.activeElement?.matches('input,textarea,select')) {
    deferredRender = true;
    return;
  }
  deferredRender = false;
  app.innerHTML = pageHtml();
  syncTitle();
  fillQR();
  syncStickyOffset();
}
/** On phones the order columns stack; each column title sticks just below the frozen status rows. */
function syncStickyOffset() {
  const frozen = app.querySelector('.orders-sticky');
  document.documentElement.style.setProperty('--orders-sticky-h', `${frozen ? frozen.offsetHeight : 0}px`);
}
window.addEventListener('resize', syncStickyOffset, { passive: true });
/** Waiting orders stay visible in the tab title, even while the merchant is typing elsewhere. */
function syncTitle() {
  const s = getState();
  if (!s || authMode) return;
  const waiting = s.orders.filter(order => order.status === 'new').length;
  const page = document.querySelector('.page-heading h1')?.textContent?.trim() || '工作台';
  document.title = `${waiting ? `(${waiting}) 新訂單｜` : ''}BrandDNA｜${s.brand.shortName}｜${page}`;
}
// New customer orders: a toast, a chime and a buzz, wherever the merchant is in the workspace.
let knownOrders = null;
function watchOrders() {
  const s = getState();
  if (!s) return;
  const ids = new Set(s.orders.map(order => order.id));
  if (!knownOrders) { knownOrders = ids; return; }
  const fresh = s.orders.filter(order => !knownOrders.has(order.id) && order.status === 'new');
  knownOrders = ids;
  if (!fresh.length) return;
  const first = fresh[0];
  toast(`新訂單 ${shortOrderNumber(first.number)}：${first.customer?.name || '顧客'} · ${money(first.total)}${fresh.length > 1 ? `，另有 ${fresh.length - 1} 筆` : ''}`);
  if (store('orders.sound', true)) sound.chime();
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
}
// Keep the screen on while the order board is open (a phone or tablet at the truck).
let wakeLock = null;
async function syncWakeLock() {
  const wanted = !authMode && ui.route === 'orders' && document.visibilityState === 'visible';
  try {
    if (wanted && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!wanted && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', syncWakeLock);
// Browsers only play sound after a tap; the first tap in the workspace unlocks the chime.
document.addEventListener('pointerdown', () => sound.unlock(), { passive: true });
/** 趨勢 is today's top three: fetched once a day (Taipei date) when the merchant opens 貼文工作區. */
function maybeRefreshTrends() {
  const s = getState();
  if (ui.route !== 'posts' || trendsRequested || !s) return;
  if (s.trends?.date === taipeiToday()) return;
  trendsRequested = true;
  ui.trendsLoading = true;
  render();
  dispatch('trends.refresh').catch(() => {}).finally(() => { ui.trendsLoading = false; render(); });
}
function navigate(path) {
  const [pathname, hash] = path.split('#');
  const clean = pathname.split('?')[0].replace(/\/$/, '') || '/';
  if (clean === '/login' || clean === '/register') { history.pushState({}, '', pathname); showAuth(clean.slice(1), { adding: pathname.includes('add=1') }); return; }
  // Leaving the sign-in screen for the workspace loads it fresh for the chosen truck.
  if (authMode) { location.assign(path); return; }
  ui.route = routes[clean] || 'dashboard';
  ui.popover = null;
  history.pushState({}, '', path);
  render(true);
  syncWakeLock();
  if (['settings', 'data', 'posts', 'analytics'].includes(ui.route)) refreshMeta().then(() => render(), () => {});
  maybeRefreshTrends();
  const target = hash && document.getElementById(hash);
  if (target) { if (target.tagName === 'DETAILS') target.open = true; target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else window.scrollTo({ top: 0 });
}
function closeNav() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.querySelector('.mobile-overlay')?.classList.remove('show');
}
const aiToast = (result, success) => toast(result?.result?.aiNotice || success, Boolean(result?.result?.aiNotice));

async function switchTruck(slug, path = location.pathname) {
  await account.switchTo(slug);
  setTabSlug(slug);
  location.assign(path);
}

async function action(el) {
  const type = el.dataset.action,
    id = el.dataset.id;
  const s = getState();
  switch (type) {
    case 'nav-open':
      document.querySelector('.sidebar').classList.add('open');
      document.querySelector('.mobile-overlay').classList.add('show');
      break;
    case 'nav-close': closeNav(); break;
    case 'modal-close': closeModal(); break;
    case 'popover':
      ui.popover = ui.popover === el.dataset.popover ? null : el.dataset.popover;
      render(true);
      break;
    case 'notify-tab': ui.notifyTab = el.dataset.tab; render(true); break;
    case 'notify-read-all': markRead(notifications(s).map(item => item.id)); render(true); break;
    case 'notify-open': {
      const item = findNotification(s, id);
      markRead([id]);
      ui.popover = null;
      if (!item) { render(true); break; }
      if (item.href) { navigate(item.href); break; }
      render(true);
      if (item.action === 'post-edit') postEditor(item.data);
      if (item.action === 'post-new') newPost(item.data, item.topicKey || '');
      if (item.action === 'campaign-new') { navigate('/members'); campaignModal(item.data); }
      break;
    }
    // --- accounts ---
    case 'known-account': {
      const signed = ui.accounts.find(row => row.username === el.dataset.username);
      if (signed) { await switchTruck(signed.slug, '/dashboard'); break; }
      showAuth('login', { prefill: el.dataset.username, password: savedPassword(el.dataset.username), adding: new URLSearchParams(location.search).get('add') === '1' });
      break;
    }
    case 'known-forget': forgetAccount(el.dataset.username); showAuth('login'); break;
    case 'truck-switch':
      if (el.dataset.slug === ui.account?.slug) { ui.popover = null; render(true); break; }
      await switchTruck(el.dataset.slug);
      break;
    case 'logout':
    case 'logout-all': {
      const result = await account.logout(type === 'logout-all');
      setTabSlug(result.active || null);
      location.assign(result.accounts?.length ? '/dashboard' : '/login');
      break;
    }
    case 'password-open': ui.popover = null; render(true); passwordModal(); break;
    // --- posts ---
    case 'post-new': newPost(el.dataset.topic || '', el.dataset.key || '', el.dataset.trend || '', el.dataset.hook || ''); break;
    case 'quick-tab': ui.quickTab = el.dataset.tab; render(true); break;
    case 'topic-fill': {
      const form = document.getElementById('generate-form');
      document.getElementById('post-topic').value = el.dataset.topic;
      if (form) form.dataset.topicKey = el.dataset.key || '';
      break;
    }
    case 'post-edit': postEditor(id); break;
    case 'post-filter': ui.postFilter = el.dataset.filter; render(true); break;
    case 'post-delete': confirmModal('刪除貼文', '確定要刪除這則貼文嗎？刪除後無法復原。', 'post-delete-confirm', { id }, '刪除'); break;
    case 'post-delete-confirm': await dispatch('post.delete', { id }); closeModal(); toast('已刪除貼文。'); render(true); break;
    case 'assistant-retry': {
      const result = await dispatch('assistant.check', { force: true });
      aiToast(result, result.result?.post ? `換成「${result.result.post.title}」草稿了。` : '目前不需要提醒。');
      render(true);
      break;
    }
    case 'assistant-dismiss': await dispatch('assistant.dismiss', {}); toast('好的，草稿留在貼文列表裡，需要時再用。'); render(true); break;
    case 'trends-refresh': {
      ui.trendsLoading = true; render(true);
      try {
        const result = await dispatch('trends.refresh');
        if (result.result?.trends?.error) toast(result.result.trends.error, true);
        else aiToast(result, '已更新今天的熱門話題與季節主題。');
      } finally { ui.trendsLoading = false; render(true); }
      break;
    }
    case 'caption-copy': await copyText(document.getElementById('edit-caption')?.value || ''); break;
    case 'caption-copy-saved': await copyText(s.posts.find(post => post.id === id)?.caption || ''); break;
    case 'image-download': {
      const post = s.posts.find(item => item.id === id);
      const image = document.getElementById('editor-form')?.dataset.id === id ? ui.editorImage : post.image;
      const card = document.getElementById('edit-card')?.value ?? post.cardTitle;
      downloadBlob(await publicationJpeg(image, card), `${post.title.replace(/[\\/:*?"<>|\s]+/g, '') || 'post'}.jpg`);
      break;
    }
    case 'metrics-open': metricsModal(id); break;
    // --- data center ---
    // Adding data happens in the panel at the top of 資料中心; other pages' "新增品牌資料" buttons lead there.
    case 'source-new': {
      ui.importTab = 'manual';
      if (ui.route !== 'data') navigate('/data-hub#import');
      else { render(true); document.getElementById('import')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      setTimeout(() => document.getElementById('add-title')?.focus({ preventScroll: true }), 350);
      break;
    }
    case 'source-edit': newSource(id); break;
    case 'source-delete-ask': confirmModal('刪除品牌資料', `確定要刪除「${esc(s.sources.find(x => x.id === id)?.title || '')}」嗎？下次品牌診斷就不會參考這筆資料。`, 'source-delete', { id }, '刪除'); break;
    case 'source-delete': await dispatch('source.delete', { id }); closeModal(); toast('已刪除品牌資料。'); render(true); break;
    case 'import-tab': ui.importTab = el.dataset.tab; render(true); break;
    case 'html-remove': ui.htmlFiles = (ui.htmlFiles || []).filter((_, index) => index !== Number(el.dataset.index)); render(true); break;
    case 'sources-analyze':
    case 'source-analyze':
      await dispatch('source.analyze', id ? { id } : {});
      toast('分析完成，可以到品牌診斷重新建立 Brand DNA。');
      render(true);
      break;
    case 'diagnosis-run': {
      toast(ui.ai?.enabled ? 'AI 正在整理 Brand DNA，約需 10 秒…' : '正在重新建立 Brand DNA…');
      const result = await dispatch('diagnosis.run');
      aiToast(result, '已重新建立 Brand DNA，之後產生的貼文會套用新的語氣。');
      render(true);
      break;
    }
    // --- Meta ---
    case 'meta-connect': {
      const { url } = await metaRequest('connect', { platform: el.dataset.platform });
      location.assign(url);
      break;
    }
    case 'meta-refresh': await refreshMeta(); render(true); break;
    case 'meta-disconnect':
      openModal('解除 Meta 連線', `<p class="body-copy">將解除 ${esc(platformLabel(el.dataset.platform))} 的工作台連線並取消未送出的排程。</p>
        <div class="modal-actions">${btn('返回', 'modal-close')}${btn('解除連線', 'meta-disconnect-confirm', 'danger', `data-platform="${el.dataset.platform}"`)}</div>`);
      break;
    case 'meta-disconnect-confirm':
      await metaRequest('disconnect', { platform: el.dataset.platform });
      await refreshMeta();
      closeModal();
      toast('已解除工作台連線。');
      render(true);
      break;
    case 'meta-import': {
      const result = await metaRequest('import', { platform: el.dataset.platform, restart: el.dataset.restart === 'true' });
      await refreshMeta();
      toast(`匯入 ${result.imported} 則新貼文。`);
      render(true);
      break;
    }
    case 'meta-sync': {
      const result = await metaRequest('insights/sync', {});
      await refreshMeta();
      toast(`已更新 ${result.synced} 則貼文成效${result.failed ? `，${result.failed} 則無法讀取` : ''}。`);
      render(true);
      break;
    }
    case 'meta-preview': await showPublicationPreview(await saveEditor(id) || id); break;
    case 'meta-edit':
    case 'meta-preview-back': postEditor(id, true); break;
    case 'meta-copy': {
      const post = s.posts.find(item => item.id === id);
      const result = await dispatch('post.update', { id, caption: post.caption || post.title });
      postEditor(result.result.post.id);
      toast('已建立草稿副本。');
      break;
    }
    case 'meta-approve': {
      const preview = getPublicationPreview();
      if (!preview) return;
      const image = preview.blob ? await uploadPublicationJpeg(preview.blob) : undefined;
      if (getPublicationPreview() !== preview) return;
      await metaRequest('approve', { id: preview.id, accountId: preview.accountId, content: preview.content, kind: preview.kind, link: preview.link, image });
      toast('已確認發布版本。');
      postEditor(preview.id);
      break;
    }
    case 'meta-publish': {
      const post = s.posts.find(item => item.id === id);
      openModal('立即發布至 Meta', `<p class="body-copy">確認後會將這則貼文發布至 ${esc(platformLabel(post.platform))} 的 ${esc(post.meta.accountName)}。</p>
        <div class="modal-actions">${btn('返回', 'post-edit', '', `data-id="${esc(id)}"`)}${btn('確認發布至 Meta', 'meta-publish-confirm', 'primary', `data-id="${esc(id)}" data-version="${esc(post.meta.version)}"`)}</div>`);
      break;
    }
    case 'meta-publish-confirm':
      await metaRequest('queue', { id, version: el.dataset.version });
      closeModal();
      toast('已交由工作台發布。請在貼文工作區查看結果。');
      break;
    case 'meta-reconcile':
      await metaRequest('reconcile', { id, importId: el.dataset.importId });
      postEditor(id);
      toast('已補上 Meta 貼文紀錄。');
      break;
    case 'meta-cancel':
      await metaRequest('cancel', { id, attempt: el.dataset.attempt });
      postEditor(id);
      toast('已取消 Meta 排程。');
      break;
    case 'post-approve':
      await saveEditor(id);
      await dispatch('post.approve', { id });
      toast('已確認，可以發布或排程了。');
      postEditor(id);
      render(true);
      break;
    case 'post-schedule':
      await saveEditor(id);
      if (getState().posts.find(p => p.id === id)?.status === 'draft') {
        postEditor(id);
        toast('內容已更新，請重新確認。');
        return;
      }
      scheduleModal(id);
      break;
    case 'post-publish':
      await saveEditor(id);
      if (getState().posts.find(p => p.id === id)?.status === 'draft') {
        postEditor(id);
        toast('內容已更新，請重新確認。');
        return;
      }
      publishModal(id);
      break;
    case 'post-publish-confirm':
      await dispatch('post.publish', { id });
      toast('已標記為已發布，可以到「貼文成效」填寫數字。');
      postEditor(id);
      render(true);
      break;
    // --- calendar ---
    case 'stall-new': stallModal('', el.dataset.date || ''); break;
    case 'stall-edit': stallModal(id); break;
    case 'stall-delete': {
      const stall = s.stalls.find(row => row.id === id);
      confirmModal('刪除出攤', `確定要刪除「${esc(stall?.title || '')}」（${esc(stall?.date || '')} ${esc(stall?.start || '')}）嗎？顧客點餐頁也不會再顯示這個地點。`, 'stall-delete-confirm', { id }, '刪除');
      break;
    }
    case 'stall-delete-confirm':
      await dispatch('stall.delete', { id });
      closeModal();
      toast('出攤已刪除。');
      render(true);
      break;
    // --- calendar colour labels ---
    case 'label-custom':
    case 'label-custom-cancel': {
      const field = document.getElementById('label-field');
      const form = field?.closest('form');
      if (!field || !form) break;
      field.outerHTML = labelField(chosenLabel(form), { creating: type === 'label-custom' });
      document.getElementById('label-name')?.focus();
      break;
    }
    case 'label-create': {
      const field = document.getElementById('label-field');
      const form = field?.closest('form');
      const name = document.getElementById('label-name')?.value.trim() || '';
      if (!name) throw new Error('請輸入標籤名稱，例如「節慶活動」。');
      const result = await dispatch('label.save', { name, color: form.querySelector('input[name="label-color"]:checked')?.value || 'blue' });
      document.getElementById('label-field').outerHTML = labelField(result.result.label.id);
      toast(`已新增「${result.result.label.name}」標籤，之後排程都能選。`);
      break;
    }
    case 'label-edit': labelModal(id || ''); break;
    case 'label-delete': confirmModal('刪除行事曆標籤', `確定要刪除「${esc(allLabels(s).find(row => row.id === id)?.name || '')}」嗎？用過它的貼文和出攤會改回預設顏色。`, 'label-delete-confirm', { id }, '刪除'); break;
    case 'label-delete-confirm': await dispatch('label.delete', { id }); closeModal(); toast('已刪除標籤。'); render(true); break;
    case 'calendar-prev': shiftCalendar(-1); render(true); break;
    case 'calendar-next': shiftCalendar(1); render(true); break;
    case 'calendar-today': shiftCalendar(0); render(true); break;
    // --- orders ---
    case 'order-next': {
      const result = await dispatch('order.status', { id, status: el.dataset.status });
      const order = result.result?.order;
      toast(order?.status === 'ready' ? `已通知 ${shortOrderNumber(order.number)} 可以取餐，顧客手機會震動提醒。` : '已更新，顧客手機上會同步顯示。按錯可以按「退回」。');
      render(true);
      break;
    }
    case 'order-back': {
      const result = await dispatch('order.status', { id, status: el.dataset.status });
      toast(`已退回為「${ORDER_STATUS_TEXT[result.result?.order?.status] || '上一步'}」。`);
      render(true);
      break;
    }
    case 'order-cancel': {
      const order = s.orders.find(row => row.id === id);
      if (!order) break;
      openModal(`取消訂單 ${esc(shortOrderNumber(order.number))}`, `<form id="cancel-form" data-id="${esc(id)}"><p class="body-copy">${esc(order.customer?.name || '')}・${esc((order.items || []).map(item => `${item.name}×${item.quantity}`).join('、'))}・${money(order.total)}</p>
        <div class="field"><label>取消原因（顧客的點餐頁會看到）</label><div class="reason-chips">${CANCEL_REASONS.map((reason, index) => `<label><input type="radio" name="reason" value="${esc(reason)}" ${index === 0 ? 'checked' : ''}><span>${esc(reason)}</span></label>`).join('')}</div></div>
        ${order.discount ? `<div class="notice sea">${icon('tag', 15)}<span>這筆訂單用了折扣碼 ${esc(order.discount.code)}，取消後會退回給顧客，可以下次再用。</span></div>` : ''}
        <div class="modal-actions">${btn('返回', 'modal-close')}<button class="btn danger" type="submit">確定取消訂單</button></div></form>`);
      break;
    }
    case 'orders-complete-ready': {
      const ready = s.orders.filter(order => order.status === 'ready');
      confirmModal('全部完成取餐', `把 ${ready.length} 筆「可取餐」訂單（${esc(ready.slice(0, 5).map(order => shortOrderNumber(order.number)).join('、'))}${ready.length > 5 ? ' 等' : ''}）都標記為已完成？沒有來取餐的訂單，建議改用「取消」。`, 'orders-complete-ready-confirm', {}, '全部完成');
      break;
    }
    case 'orders-complete-ready-confirm': {
      const result = await dispatch('order.completeReady');
      closeModal();
      toast(`已完成 ${result.result?.completed || 0} 筆訂單。`);
      render(true);
      break;
    }
    case 'ordering-toggle': {
      const ordering = s.settings?.ordering || {};
      if (ordering.paused) {
        await dispatch('settings.update', { ordering: { paused: false } });
        toast('已恢復線上接單，顧客可以點餐了。');
        render(true);
        break;
      }
      openModal('暫停線上接單', `<form id="ordering-form"><p class="body-copy">暫停後，顧客點餐頁會顯示下面這段說明，無法送出新訂單；已經送出的訂單不受影響。</p>
        <div class="field"><label for="ordering-message">給顧客的說明（選填）</label><input id="ordering-message" maxlength="80" value="${esc(ordering.message || '')}" placeholder="例如：今天的餐點都賣完了，謝謝大家！"></div>
        <div class="reason-chips">${['今天的餐點都賣完了，謝謝大家！', '單量較多，暫停 20 分鐘後再開放。', '今天休息，下次出車見！'].map(text => `<button type="button" class="chip" data-action="ordering-preset" data-text="${esc(text)}">${esc(text)}</button>`).join('')}</div>
        <div class="modal-actions">${btn('返回', 'modal-close')}<button class="btn danger" type="submit">暫停接單</button></div></form>`);
      break;
    }
    case 'ordering-preset': document.getElementById('ordering-message').value = el.dataset.text; break;
    case 'order-sound': {
      const next = !store('orders.sound', true);
      remember('orders.sound', next);
      if (next) { sound.unlock(); sound.chime(); }
      toast(next ? '新訂單會響提示音（請保持這個頁面開著）。' : '已關閉提示音，新訂單仍會跳出提醒。');
      render(true);
      break;
    }
    case 'copy-link': await copyText(orderUrl()); break;
    case 'asset-download': await downloadAsset(el.dataset.kind, s); toast('已下載，可以列印或分享給顧客。'); break;
    // --- analytics ---
    case 'meta-feedback':
    case 'analytics-feedback': {
      const result = await dispatch('analytics.feedback', { mode: type === 'meta-feedback' ? 'meta' : 'manual' });
      ui.highlightSource = result.result?.source?.id || null;
      navigate('/data-hub');
      document.getElementById(`source-${ui.highlightSource}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('已把成效回饋加入資料中心，記得按「分析」再重新建立 Brand DNA。');
      setTimeout(() => { ui.highlightSource = null; }, 8000);
      break;
    }
    // --- menu ---
    case 'menu-edit': menuModal(id); break;
    case 'menu-category': ui.menuCategory = el.dataset.category; render(true); break;
    case 'menu-soldout': {
      const item = s.menu.find(row => row.id === id);
      const soldOut = !(item.soldOutOn === new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
      await dispatch('menu.soldout', { id, soldOut });
      toast(soldOut ? `「${item.name}」今日售完，明天會自動恢復。` : `「${item.name}」恢復供應。`);
      render(true);
      break;
    }
    case 'menu-listing': await dispatch('menu.listing', { id, available: el.dataset.available === 'true' }); render(true); break;
    case 'menu-move': await dispatch('menu.move', { id, direction: el.dataset.direction }); render(true); break;
    case 'menu-restock': { const result = await dispatch('menu.restock'); toast(`${result.result.restocked} 道餐點恢復供應。`); render(true); break; }
    case 'menu-delete': confirmModal('刪除餐點', `確定要刪除「${esc(s.menu.find(row => row.id === id)?.name || '')}」嗎？只是暫時不賣的話，建議用「下架」。`, 'menu-delete-confirm', { id }, '刪除'); break;
    case 'menu-delete-confirm': await dispatch('menu.delete', { id }); closeModal(); toast('已刪除餐點。'); render(true); break;
    case 'menu-photo-clear': {
      ui.menuImage = '';
      document.getElementById('menu-photo-preview').innerHTML = `<span>${icon('image', 26)}<br>尚未上傳照片</span>`;
      el.remove();
      break;
    }
    case 'menu-translate': {
      toast('AI 正在翻譯英文菜單…');
      const result = await dispatch('menu.translate');
      toast(`已翻譯 ${result.result.translated} 道餐點，可以在點餐頁切換 English 確認。`);
      render(true);
      break;
    }
    // --- members ---
    case 'member-tab': ui.memberTab = el.dataset.tab; render(true); break;
    case 'member-filter': ui.memberTab = 'members'; ui.memberSegment = el.dataset.segment; render(true); break;
    case 'member-sort': {
      const key = el.dataset.key;
      ui.memberSort = { key, dir: ui.memberSort.key === key && ui.memberSort.dir === 'desc' ? 'asc' : 'desc' };
      render(true);
      break;
    }
    case 'member-open': memberDetail(id); break;
    case 'member-login-code': {
      const result = await dispatch('member.loginCode', { id });
      const box = document.getElementById('member-login-code');
      const until = new Date(result.result.expiresAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
      if (box) box.innerHTML = `<strong class="login-code">${esc(result.result.code)}</strong><span>請顧客在點餐頁「加入會員」輸入同一支手機，再輸入這組登入碼。${esc(until)} 前有效，只能用一次。</span>`;
      break;
    }
    case 'member-delete': confirmModal('刪除會員', '刪除後這位會員的資料與專屬優惠會移除，訂單紀錄會保留為訪客訂單。', 'member-delete-confirm', { id }, '刪除'); break;
    case 'member-delete-confirm': await dispatch('member.delete', { id }); closeModal(); toast('已刪除會員。'); render(true); break;
    case 'campaign-new': campaignModal(el.dataset.segment); break;
    case 'campaign-ai': {
      const form = document.getElementById('campaign-form');
      const { copy } = await aiCopy(campaignCopyInput(form));
      if (!copy) { toast('AI 助理目前無法使用，已保留範本文字。', true); break; }
      document.getElementById('campaign-title').value = String(copy.title || '').slice(0, 60);
      document.getElementById('campaign-message').value = String(copy.message || '').replace(/\{折扣碼\}/g, '專屬折扣碼').slice(0, 500);
      toast('已用 AI 改寫，送出前可以再修改。');
      break;
    }
    case 'coupon-new': couponModal(); break;
    case 'coupon-toggle': {
      const coupon = s.coupons.find(row => row.id === id);
      await dispatch('coupon.toggle', { id, active: !coupon.active });
      render(true);
      break;
    }
    // --- settings & guide ---
    case 'brand-edit': brandModal(); break;
    case 'member-settings': memberSettingsModal(); break;
    case 'workspace-reset': confirmModal('還原初始資料', '貼文、訂單、會員、菜單與折扣碼都會回到初始狀態，此動作無法復原。', 'reset-confirm', {}, '確定還原'); break;
    case 'reset-confirm': await dispatch('workspace.reset'); closeModal(); toast('已還原初始資料。'); render(true); break;
    case 'guide-done': {
      const done = new Set(store('guide.done', []));
      done.has(id) ? done.delete(id) : done.add(id);
      remember('guide.done', [...done]);
      render(true);
      break;
    }
    case 'reload': location.reload(); break;
  }
}

document.addEventListener('click', async e => {
  // Clicking outside an open popover closes it.
  if (ui.popover && !e.target.closest('.popover-wrap')) { ui.popover = null; render(true); }
  const link = e.target.closest('a[href]');
  if (link && link.getAttribute('href').startsWith('/') && !link.target && !link.getAttribute('href').startsWith('/legacy/') && !link.getAttribute('href').startsWith('/order') && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    closeNav();
    navigate(link.getAttribute('href'));
    return;
  }
  const el = e.target.closest('[data-action]');
  if (el) {
    e.preventDefault();
    if (el.disabled) return;
    el.disabled = true;
    try {
      await action(el);
    } catch (err) {
      modalError(err);
    } finally {
      el.disabled = false;
    }
  } else if (e.target.classList.contains('modal-backdrop')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (modalRoot.children.length) closeModal();
    else if (ui.popover) { ui.popover = null; render(true); }
  }
  // Enter in the new-label name adds the label instead of submitting the schedule / stall form around it.
  if (e.key === 'Enter' && e.target.id === 'label-name') {
    e.preventDefault();
    document.querySelector('[data-action="label-create"]')?.click();
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.draft-card,.assistant-draft,tr[data-action]')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === 'Tab' && modalRoot.children.length) {
    const nodes = [...modalRoot.querySelectorAll('a[href],button,input,select,textarea')].filter(x => !x.disabled && !x.closest('[hidden]'));
    if (e.shiftKey && document.activeElement === nodes[0]) {
      e.preventDefault();
      nodes.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
      e.preventDefault();
      nodes[0].focus();
    }
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'edit-caption') {
    document.getElementById('preview-caption').textContent = e.target.value;
    document.getElementById('editor-hint').textContent = '有未儲存的修改，儲存後要重新確認。';
  }
  if (e.target.id === 'edit-card') {
    const el = document.getElementById('preview-card');
    el.textContent = e.target.value;
    el.hidden = !e.target.value;
  }
  // The data hub's add-data panel keeps what is typed, so a pushed update (new order…) never wipes it.
  if (e.target.dataset?.draft) draft()[e.target.dataset.draft] = e.target.value;
  if (e.target.id === 'import-batch-text') {
    const count = splitBatch(e.target.value).length;
    document.getElementById('import-batch-count').textContent = count ? `將匯入 ${count} 筆資料（最多 20 筆）。` : '每篇之間用單獨一行「---」分隔，最多 20 篇。';
  }
});
// Files can be dropped onto any upload zone (the file input inside it receives them).
document.addEventListener('dragover', e => {
  const zone = e.target.closest?.('.upload-zone');
  if (!zone) return;
  e.preventDefault();
  zone.classList.add('dragging');
});
document.addEventListener('dragleave', e => e.target.closest?.('.upload-zone')?.classList.remove('dragging'));
document.addEventListener('drop', e => {
  const zone = e.target.closest?.('.upload-zone');
  const input = zone?.querySelector('input[type="file"]');
  if (!input || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  zone.classList.remove('dragging');
  input.files = e.dataTransfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
async function withUpload(input, run) {
  const form = input.closest('form');
  const buttons = [...(form?.querySelectorAll('button') || [])].map(button => ({ button, disabled: button.disabled }));
  form && (form.dataset.uploading = 'true');
  input.disabled = true;
  buttons.forEach(({ button }) => (button.disabled = true));
  try { await run(); } catch (err) { modalError(err); } finally {
    if (form && document.body.contains(form)) {
      delete form.dataset.uploading;
      input.disabled = false;
      buttons.forEach(({ button, disabled }) => (button.disabled = disabled));
    }
  }
}
document.addEventListener('change', async e => {
  const target = e.target;
  if (target.id === 'meta-post-kind') document.getElementById('meta-post-link-field').hidden = target.value !== 'link';
  if (target.name === 'campaign-kind' || target.id === 'offer-kind') syncCampaignForm();
  if (target.id === 'coupon-kind') syncCouponForm();
  if (target.dataset?.draft) draft()[target.dataset.draft] = target.value;
  if (target.id === 'trend-coupon-on') document.querySelectorAll('.trend-coupon input:not(#trend-coupon-on),.trend-coupon select').forEach(field => { field.disabled = !target.checked; });
  if (target.id === 'import-files' && target.files.length) {
    try { ui.importFiles = await readTextFiles(target.files); } catch (err) { ui.importFiles = []; toast(err.message, true); }
    if (target.files.length > 20) toast('一次最多 20 個檔案，只會匯入前 20 個。', true);
    render(true);
  }
  if (target.id === 'import-html-files' && target.files.length) {
    ui.htmlFiles = [...(ui.htmlFiles || []), ...await readHtmlFiles(target.files)].slice(0, 20);
    const failed = ui.htmlFiles.filter(file => file.error).length;
    if (failed) toast(`有 ${failed} 個檔案讀不到內容，原因寫在清單裡。`, true);
    render(true);
  }
  if (target.id === 'add-file' && target.files[0]) {
    const file = target.files[0];
    const d = draft();
    try {
      if (file.type.startsWith('image/')) {
        const url = await uploadPhoto(file);
        d.manualContent = `品牌圖片素材：${file.name}\n圖片位置：${url}\n（在這裡補充照片內容，例如餐點名稱、拍攝場合）`;
        d.manualType = 'manual';
      } else {
        if (file.size > 1024 * 1024) throw new Error('文字檔上限為 1 MB。');
        d.manualContent = (await file.text()).slice(0, 20000);
      }
      if (!d.manualTitle) d.manualTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
    } catch (err) { toast(err.message, true); }
    render(true);
  }
  if (target.id === 'source-file') {
    const file = target.files[0],
      form = target.closest('#source-form');
    if (!file || !form) return;
    const isCurrent = () => document.getElementById('source-form') === form;
    try {
      if (file.type.startsWith('image/')) {
        const url = await uploadPhoto(file);
        if (!isCurrent()) return;
        document.getElementById('source-content').value = `品牌圖片素材：${file.name}\n圖片位置：${url}\n（在這裡補充照片內容，例如餐點名稱、拍攝場合）`;
        document.getElementById('source-type').value = 'manual';
      } else {
        if (file.size > 1024 * 1024) throw new Error('文字檔上限為 1 MB。');
        const content = await file.text();
        if (!isCurrent()) return;
        document.getElementById('source-content').value = content.slice(0, 20000);
      }
      if (!document.getElementById('source-title').value) document.getElementById('source-title').value = file.name;
    } catch (err) {
      if (isCurrent()) modalError(err);
    }
  }
  if (target.id === 'edit-photo' && target.files[0]) {
    const form = target.closest('#editor-form');
    await withUpload(target, async () => {
      const image = await uploadPhoto(target.files[0]);
      if (document.getElementById('editor-form') !== form) return;
      ui.editorImage = image;
      document.getElementById('preview-photo').src = image;
      toast('照片已上傳，按「儲存草稿」或「確認內容」後才會套用。');
    });
  }
  if (target.id === 'menu-photo' && target.files[0]) {
    await withUpload(target, async () => {
      ui.menuImage = await uploadPhoto(target.files[0]);
      document.getElementById('menu-photo-preview').innerHTML = `<img src="${esc(ui.menuImage)}" alt="餐點照片預覽">`;
    });
  }
  if (target.id === 'import-ocr-file' && target.files[0]) {
    await withUpload(target, async () => { ui.ocrImage = await uploadPhoto(target.files[0]); });
    render(true);
  }
});

const FORMS = '#source-form,#generate-form,#editor-form,#schedule-form,#stall-form,#menu-form,#login-form,#register-form,.meta-select-form,#metrics-form,#brand-form,#password-form,#member-settings-form,#campaign-form,#coupon-form,#add-manual-form,#import-html-form,#import-ocr-form,#import-batch-form,#import-files-form,#cancel-form,#ordering-form,#label-form';
async function importItems(payload, label, tab) {
  const result = await dispatch('source.import', payload);
  resetDraft(tab);
  ui.highlightSource = result.result?.sources?.[0]?.id || null;
  toast(`已匯入 ${result.result.imported} 筆${label}，記得按「分析」。`);
  if (ui.route !== 'data') navigate('/data-hub');
  else render(true);
  document.getElementById(`source-${ui.highlightSource}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => { ui.highlightSource = null; }, 8000);
}
document.addEventListener('submit', async e => {
  const form = e.target;
  if (!form.matches(FORMS)) return;
  e.preventDefault();
  const submits = [...form.querySelectorAll('button')];
  submits.forEach(b => (b.disabled = true));
  try {
    if (form.matches('.meta-select-form')) {
      await metaRequest('select', { platform: form.dataset.platform, accountId: form.elements.accountId.value });
      await refreshMeta();
      history.replaceState({}, '', location.pathname);
      render(true);
      toast('已連線所選的 Meta 帳號。');
      return;
    }
    switch (form.id) {
      case 'login-form': {
        const username = form.elements.username.value.trim(), password = form.elements.password.value;
        let result;
        try {
          result = await account.login(username, password);
        } catch (err) {
          // The remembered password no longer works (e.g. it was changed on another device): forget it.
          if (err.status === 401 && filledLogin && filledLogin.username === username && filledLogin.password === password) {
            forgetPassword(username);
            filledLogin = null;
            form.elements.password.value = '';
            document.getElementById('login-saved-hint').hidden = true;
            form.elements.password.focus();
            throw new Error('這台裝置記住的密碼已經失效（可能改過密碼），請重新輸入密碼。');
          }
          throw err;
        }
        rememberAccount(result.account, form.elements.remember.checked ? password : null);
        setTabSlug(result.account.slug);
        location.assign('/dashboard');
        return;
      }
      case 'register-form': {
        if (form.elements.password.value !== form.elements.confirm.value) throw new Error('兩次輸入的密碼不一樣。');
        const result = await account.register({ storeName: form.elements.storeName.value.trim(), username: form.elements.username.value.trim(), password: form.elements.password.value });
        rememberAccount(result.account, form.elements.remember.checked ? form.elements.password.value : null);
        setTabSlug(result.account.slug);
        location.assign('/dashboard');
        return;
      }
      case 'source-form': {
        const payload = { title: document.getElementById('source-title').value.trim(), type: document.getElementById('source-type').value, content: document.getElementById('source-content').value.trim() };
        if (form.dataset.id) await dispatch('source.update', { id: form.dataset.id, ...payload });
        else await dispatch('source.add', payload);
        closeModal();
        toast('已儲存，記得按「分析」。');
        break;
      }
      case 'add-manual-form': {
        const d = draft();
        const result = await dispatch('source.add', { title: d.manualTitle.trim(), type: d.manualType, content: d.manualContent.trim() });
        resetDraft('manual');
        ui.highlightSource = result.result?.source?.id || null;
        toast('已新增，記得按「分析」。');
        render(true);
        setTimeout(() => { ui.highlightSource = null; }, 8000);
        return;
      }
      case 'import-html-form': {
        const pages = (ui.htmlFiles || []).filter(file => !file.error && file.content);
        if (!pages.length) throw new Error('請先選擇讀得到內容的 .html 檔。');
        await importItems({ kind: 'batch', items: pages.map(page => ({ title: page.title, type: draft().htmlType, content: page.content })) }, '網頁內容', 'html');
        return;
      }
      case 'import-ocr-form': {
        if (!ui.ocrImage) throw new Error('請先選擇要辨識的圖片。');
        const d = draft();
        await importItems({ kind: 'ocr', image: ui.ocrImage, title: d.ocrTitle.trim(), type: d.ocrType, hint: d.ocrHint.trim() }, '圖片文字', 'ocr');
        return;
      }
      case 'import-batch-form': {
        const d = draft();
        const parts = splitBatch(d.batchText);
        if (!parts.length) throw new Error('請貼上至少一篇內容。');
        const prefix = d.batchPrefix.trim() || '匯入資料';
        await importItems({ kind: 'batch', items: parts.map((content, index) => ({ title: `${prefix} ${index + 1}`, type: d.batchType, content: content.slice(0, 20000) })) }, '資料', 'batch');
        return;
      }
      case 'import-files-form': {
        const files = ui.importFiles || [];
        if (!files.length) throw new Error('請選擇至少一個檔案。');
        await importItems({ kind: 'batch', items: files.map(file => ({ title: file.title, type: draft().filesType, content: file.content })) }, '檔案', 'files');
        return;
      }
      case 'generate-form': {
        // 時事折扣碼: create it first (or reuse an active one with the same code), so the draft can mention it.
        let couponCode = '';
        if (document.getElementById('trend-coupon-on')?.checked) {
          const code = document.getElementById('trend-coupon-code').value.trim().toUpperCase();
          if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new Error('折扣碼只能用 3 到 20 個英文字母或數字。');
          const existing = getState().coupons.find(coupon => coupon.code === code && coupon.active);
          if (existing) couponCode = existing.code;
          else {
            const kind = document.getElementById('trend-coupon-kind').value;
            const created = await dispatch('coupon.create', { code, kind, value: Number(document.getElementById('trend-coupon-value').value || 0), label: document.getElementById('trend-coupon-label').value.trim(), days: Number(document.getElementById('trend-coupon-days').value || 3), minSpend: 0 });
            couponCode = created.result.coupon.code;
          }
        }
        toast(ui.ai?.enabled ? 'AI 正在依品牌語氣寫草稿…' : '正在產生草稿…');
        const res = await dispatch('post.generate', {
          platform: document.getElementById('post-platform').value,
          topic: document.getElementById('post-topic').value.trim(),
          ...(form.dataset.topicKey ? { topicKey: form.dataset.topicKey } : {}),
          ...(form.dataset.trendId ? { trendId: form.dataset.trendId } : {}),
          ...(form.dataset.hookId ? { hookId: form.dataset.hookId } : {}),
          ...(couponCode ? { couponCode } : {}),
        });
        const p = res.result?.post || getState().posts[0];
        postEditor(p.id);
        aiToast(res, couponCode ? `已建立折扣碼 ${couponCode}，草稿也寫好了，改好後按「確認內容」。` : '草稿已產生，改好後按「確認內容」。');
        break;
      }
      case 'editor-form': {
        const id = await saveEditor(form.dataset.id);
        toast('草稿已儲存。');
        postEditor(id || form.dataset.id);
        break;
      }
      case 'schedule-form': {
        const id = form.dataset.id;
        const scheduledAt = new Date(document.getElementById('schedule-at').value + ':00+08:00').toISOString();
        const label = chosenLabel(form);
        if (form.dataset.version) {
          await metaRequest('queue', { id, scheduledAt, version: form.dataset.version });
          if (label) await dispatch('post.label', { id, label });
        } else await dispatch('post.schedule', { id, scheduledAt, ...(label ? { label } : {}) });
        closeModal();
        toast(form.dataset.version ? '已安排 Meta 自動發布。' : '已加入排程，可以到行事曆查看。');
        break;
      }
      case 'stall-form': {
        const payload = {
          title: document.getElementById('stall-title').value,
          date: document.getElementById('stall-date').value,
          start: document.getElementById('stall-start').value,
          end: document.getElementById('stall-end').value,
          location: document.getElementById('stall-location').value,
          notes: document.getElementById('stall-notes').value,
          label: chosenLabel(form) || 'stall',
        };
        if (form.dataset.id) payload.id = form.dataset.id;
        await dispatch('stall.save', payload);
        closeModal();
        toast('出攤已儲存。');
        break;
      }
      case 'menu-form':
        await dispatch('menu.save', menuPayload(form));
        closeModal();
        toast('餐點已儲存，顧客點餐頁會立即更新。');
        break;
      case 'metrics-form': {
        const value = key => Number(document.getElementById(`metric-${key}`).value || 0);
        await dispatch('post.metrics', { id: form.dataset.id, reach: value('reach'), likes: value('likes'), comments: value('comments'), saves: value('saves'), clicks: value('clicks') });
        closeModal();
        toast('已儲存成效。');
        break;
      }
      case 'brand-form': {
        const value = id => document.getElementById(id).value.trim();
        const result = await dispatch('brand.update', { name: value('brand-name'), shortName: value('brand-short'), tagline: value('brand-tagline'), location: value('brand-location'), description: value('brand-description'), nameEn: value('brand-name-en'), descriptionEn: value('brand-description-en'), instagram: value('brand-instagram'), website: value('brand-website') });
        if (ui.account) { ui.account = { ...ui.account, name: result.result.brand.name }; ui.accounts = ui.accounts.map(row => row.slug === ui.account.slug ? ui.account : row); rememberAccount(ui.account); }
        closeModal();
        toast('品牌資料已更新。');
        break;
      }
      case 'password-form': {
        if (document.getElementById('password-next').value !== document.getElementById('password-confirm').value) throw new Error('兩次輸入的新密碼不一樣。');
        const next = document.getElementById('password-next').value;
        await account.changePassword(document.getElementById('password-current').value, next);
        const remembered = ui.account && savedPassword(ui.account.username);
        if (remembered) rememberAccount(ui.account, next);
        closeModal();
        toast(remembered ? '密碼已更新，這台裝置記住的密碼也一併更新。' : '密碼已更新。');
        break;
      }
      case 'member-settings-form': {
        const value = id => Number(document.getElementById(id).value);
        await dispatch('settings.update', { profileReward: value('set-reward'), rfm: { loyalOrders: value('set-loyal'), activeDays: value('set-active'), churnDays: value('set-churn'), bigOrder: value('set-big') } });
        closeModal();
        toast('會員設定已更新，分群會立即重新計算。');
        break;
      }
      case 'campaign-form': {
        const payload = campaignPayload(form);
        const result = await dispatch('campaign.send', payload);
        closeModal();
        toast(`已推播給 ${result.result.campaign.recipients.length} 位${payload.segmentLabel}${result.result.coupon ? `，折扣碼 ${result.result.coupon.code}` : ''}。`);
        break;
      }
      case 'coupon-form': {
        const result = await dispatch('coupon.create', couponPayload());
        closeModal();
        toast(`已建立折扣碼 ${result.result.coupon.code}。`);
        break;
      }
      case 'cancel-form': {
        const result = await dispatch('order.cancel', { id: form.dataset.id, reason: form.elements.reason?.value || '' });
        closeModal();
        const order = result.result.order;
        toast(`已取消 ${shortOrderNumber(order.number)}${order.discount ? `，折扣碼 ${order.discount.code} 已退回` : ''}，顧客手機會顯示取消。`);
        break;
      }
      case 'label-form': {
        const result = await dispatch('label.save', { ...(form.dataset.id ? { id: form.dataset.id } : {}), name: document.getElementById('label-form-name').value.trim(), color: form.querySelector('input[name="label-form-color"]:checked')?.value || 'blue' });
        closeModal();
        toast(`「${result.result.label.name}」標籤已儲存。`);
        break;
      }
      case 'ordering-form': {
        await dispatch('settings.update', { ordering: { paused: true, message: document.getElementById('ordering-message').value.trim() } });
        closeModal();
        toast('已暫停線上接單。要恢復時按「恢復接單」。');
        break;
      }
    }
    render(true);
  } catch (err) {
    const inline = form.querySelector('.modal-error') || modalRoot.querySelector('.modal-error');
    if (inline) inline.textContent = err.message;
    else modalError(err);
  } finally {
    if (document.body.contains(form)) submits.forEach(b => (b.disabled = form.dataset.uploading === 'true' && b.dataset.action !== 'modal-close'));
  }
});
window.addEventListener('popstate', () => {
  const path = location.pathname.replace(/\/$/, '') || '/';
  if (path === '/login' || path === '/register') { showAuth(path.slice(1)); return; }
  if (authMode) { location.reload(); return; }
  ui.route = routes[path] || 'dashboard';
  render(true);
  syncWakeLock();
});
document.addEventListener('focusout', () => {
  if (deferredRender)
    setTimeout(() => {
      if (deferredRender && !document.activeElement?.matches('input,textarea,select')) render();
    }, 0);
});
subscribe(() => { watchOrders(); render(); syncTitle(); });
window.addEventListener('truck-session-expired', () => { if (!authMode) showAuth('login', { error: '登入已過期或已在其他裝置登出，請重新登入。' }); });

async function boot() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  let session;
  try {
    session = await account.session();
  } catch (err) {
    app.innerHTML = `<div class="boot"><div style="text-align:center">${icon('truck', 36)}<h2 style="margin:15px 0">工作台暫時無法連線</h2><p class="muted">${esc(err.message)}</p><button class="btn primary" data-action="reload" style="margin-top:12px">重新載入</button></div></div>`;
    return;
  }
  ui.accounts = session.accounts || [];
  if (path === '/login' || path === '/register' || !ui.accounts.length) {
    showAuth(path === '/register' ? 'register' : 'login');
    return;
  }
  const preferred = [tabSlug(), session.active].find(slug => ui.accounts.some(row => row.slug === slug)) || ui.accounts[0].slug;
  ui.account = ui.accounts.find(row => row.slug === preferred);
  setWorkspace(preferred);
  setTabSlug(preferred);
  rememberAccount(ui.account);
  try {
    // Realtime via WebSocket; polling every 15s only while the socket is down.
    await init({ view: 'merchant', pollMs: 15000, workspace: preferred });
    watchOrders();
    await refreshMeta().catch(() => {});
    render(true);
    syncWakeLock();
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  } catch (err) {
    if (err.status === 401) { showAuth('login', { error: '請重新登入。' }); return; }
    app.innerHTML = `<div class="boot"><div style="text-align:center">${icon('truck', 36)}<h2 style="margin:15px 0">工作台暫時無法連線</h2><p class="muted">${esc(err.message)}</p><button class="btn primary" data-action="reload" style="margin-top:12px">重新載入</button></div></div>`;
    return;
  }
  aiStatus().then(result => { ui.ai = result.ai; render(); }, () => { ui.ai = { enabled: false }; });
  maybeRefreshTrends();
  // Once per tab: check the posting rhythm (three quiet days → a ready-made draft).
  const checkKey = `branddna.truck.assistant.${preferred}`;
  let checked = false;
  try { checked = sessionStorage.getItem(checkKey) === new Date().toDateString(); sessionStorage.setItem(checkKey, new Date().toDateString()); } catch { /* private mode */ }
  if (!checked) {
    dispatch('assistant.check').then(result => {
      if (result.result?.post) { toast(`已經 ${getState().assistant.idleDays} 天沒有發文，幫你準備了「${result.result.post.title}」草稿。`); render(); }
    }, () => {});
  }
}
boot();
