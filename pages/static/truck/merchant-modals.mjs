// Dialogs (forms) of the merchant workspace.
import { getState, dispatch, esc, money, icon } from './client.mjs';
import { accountFor, externalPost, metaStatusLabel, platformLabel, publicationJpeg } from './merchant-meta.mjs';
import { ui, dateLabel, badge, btn, toast, initial, TOPICS, topicLabel } from './merchant-ui.mjs';
import { trendWarning } from './merchant-quickstart.mjs';
import { labelField, defaultLabel, swatches, allLabels } from './merchant-labels.mjs';
import { libTag } from './merchant-dna.mjs';

export const modalRoot = document.getElementById('modal-root');
let preview = null;
export const getPublicationPreview = () => preview;

function clearPublicationPreview() {
  if (preview?.url) URL.revokeObjectURL(preview.url);
  preview = null;
}
export function openModal(title, body, { wide = false } = {}) {
  clearPublicationPreview();
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title.replace(/<[^>]+>/g, ''))}"><div class="modal-head"><h2>${title}</h2><button class="icon-button" data-action="modal-close" aria-label="關閉">${icon('close', 19)}</button></div>${body}<p class="modal-error" role="alert"></p></section></div>`;
  setTimeout(() => modalRoot.querySelector('input:not([type=hidden]):not([readonly]),textarea,select,button:not([data-action="modal-close"])')?.focus(), 0);
}
export function closeModal() {
  clearPublicationPreview();
  modalRoot.innerHTML = '';
}
export function modalError(err) {
  const el = modalRoot.querySelector('.modal-error');
  if (el) el.textContent = err.message || String(err);
  else toast(err.message || String(err), true);
}
/** Confirmation for destructive actions; the confirm button carries the real action. */
export function confirmModal(title, message, action, data = {}, label = '確定') {
  const attrs = Object.entries(data).map(([key, value]) => `data-${key}="${esc(value)}"`).join(' ');
  openModal(title, `<p class="body-copy">${message}</p><div class="modal-actions">${btn('取消', 'modal-close')}${btn(label, action, 'danger', attrs)}</div>`);
}

export const SOURCE_TYPES = [['manual', '手動文字'], ['brand', '品牌故事'], ['instagram', 'Instagram 貼文'], ['facebook', 'Facebook 貼文'], ['website', '品牌網站內容'], ['menu', '餐點資料'], ['note', '經營筆記'], ['performance', '成效回饋']];
export function newSource(id) {
  const source = getState().sources.find(x => x.id === id);
  const type = source?.type || 'manual';
  openModal(
    source ? '編輯品牌資料' : '新增品牌資料',
    `<form id="source-form" data-id="${esc(id || '')}"><div class="field"><label for="source-title">資料名稱</label><input id="source-title" required maxlength="100" value="${esc(source?.title || '')}" placeholder="例如：品牌故事、社群貼文、餐點介紹"></div><div class="field"><label for="source-type">來源類型</label><select id="source-type">${SOURCE_TYPES.map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('')}${SOURCE_TYPES.some(([value]) => value === type) ? '' : `<option value="${esc(type)}" selected>${esc(type)}</option>`}</select></div>${source ? '' : `<div class="field"><label for="source-file">從檔案匯入（選填）</label><input id="source-file" type="file" accept=".txt,.md,.csv,.json,image/jpeg,image/png,image/webp" class="source-file"><small>文字檔會直接填入下方內容；圖片會存成品牌素材。要辨識圖片裡的文字，請用「進階匯入」。</small></div>`}<div class="field"><label for="source-content">品牌內容／來源摘要</label><textarea id="source-content" required maxlength="20000" placeholder="貼上品牌介紹、既有社群文案或餐點特色…">${esc(source?.content || '')}</textarea><small>${source ? '修改後狀態會改回「待分析」。' : '品牌診斷會參考這段文字。'}</small></div><div class="modal-actions">${source ? btn(`${icon('trash', 13)} 刪除`, 'source-delete', 'danger', `data-id="${esc(id)}"`) : ''}${btn('取消', 'modal-close')}<button type="submit" class="btn primary">${source ? '儲存變更' : '新增資料'}</button></div></form>`,
  );
}


/** 時事折扣碼 section of the create-post dialog, prefilled from the hook's suggested offer. */
function trendCouponFields(offer) {
  const days = 3;
  return `<fieldset class="trend-coupon"><label class="inline-toggle"><input type="checkbox" id="trend-coupon-on" checked> 同時建立時事折扣碼，並寫進貼文</label>
    <div class="trend-coupon-fields"><div class="field"><label for="trend-coupon-code">折扣碼</label><input id="trend-coupon-code" maxlength="20" value="${esc(offer.code)}" style="text-transform:uppercase"></div>
    <div class="field"><label for="trend-coupon-kind">優惠方式</label><select id="trend-coupon-kind"><option value="amount" ${offer.kind === 'amount' ? 'selected' : ''}>折抵金額（NT$）</option><option value="percent" ${offer.kind === 'percent' ? 'selected' : ''}>全單打折（%）</option></select></div>
    <div class="field"><label for="trend-coupon-value">折多少</label><input id="trend-coupon-value" type="number" min="1" max="90" value="${esc(offer.value)}"></div>
    <div class="field"><label for="trend-coupon-days">有效天數</label><input id="trend-coupon-days" type="number" min="1" max="30" value="${days}"></div></div>
    <div class="field"><label for="trend-coupon-label">優惠說明（顧客會看到）</label><input id="trend-coupon-label" maxlength="60" value="${esc(offer.label)}"></div>
    <small>公開折扣碼：任何顧客結帳時輸入就能用，時事熱度過了可以到「會員管理 → 折扣碼」停用。</small></fieldset>`;
}
export function newPost(topic = '', topicKey = '', trendId = '', hookId = '') {
  const s = getState();
  const trend = trendId ? s.trends?.items?.find(item => item.id === trendId) : null;
  const hook = trend && hookId ? trend.hooks?.find(item => item.id === hookId) : null;
  openModal(
    hook ? '用時事梗建立貼文' : '建立貼文',
    `<form id="generate-form" data-topic-key="${esc(topicKey)}" data-trend-id="${esc(trend ? trendId : '')}" data-hook-id="${esc(hook ? hookId : '')}">${trend ? trendWarning({ title: trend.title, riskLevel: trend.riskLevel, riskNote: trend.riskNote, sources: trend.sources }, true) : ''}${hook ? `<div class="trend-hook chosen"><span class="eyebrow muted">這次的梗</span><strong>「${esc(hook.title)}」</strong><p>${esc(hook.angle)}</p></div>${hook.offer ? trendCouponFields(hook.offer) : ''}` : ''}<div class="notice sea">${icon('sparkles', 16)}<span>${ui.ai?.enabled ? 'AI 會依目前的品牌診斷、菜單和出攤行程寫草稿，之後可以再改。' : '會依目前的品牌診斷和菜單產生草稿範本，之後可以再改。'}</span></div><div class="field"><label for="post-platform">發布平台</label><select id="post-platform"><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select></div><div class="field"><label for="post-topic">想分享的主題</label><textarea id="post-topic" required maxlength="500" placeholder="例如：週末要出車，想邀請大家來吃海陸炒泡麵，也分享夥伴們的努力。">${esc(topic)}</textarea><div class="tags">${TOPICS.slice(0, 6).map(t => `<button type="button" class="tag tag-button" data-action="topic-fill" data-topic="${esc(t.topic)}" data-key="${t.key}">${esc(t.label)}</button>`).join('')}</div></div>${s.diagnosis.status === 'ready' ? `<div class="field"><label>目前的品牌定位</label><p class="body-copy">${esc(s.diagnosis.positioning)}</p><div class="tags">${s.diagnosis.tone.map(t => libTag(t, 'tone')).join('')}</div></div>` : `<div class="notice">${icon('info', 16)}<span>還沒有建立 Brand DNA，草稿會比較通用。可以先到資料中心補充品牌資料。</span></div>`}<div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit">${icon('sparkles', 14)}產生草稿</button></div></form>`,
  );
}
function handle(s) {
  const match = String(s.brand?.instagram || '').match(/instagram\.com\/([A-Za-z0-9_.]+)/);
  return match?.[1] || (s.brand?.shortName || 'truck');
}
export function postEditor(id, editConfirmed = false) {
  const s = getState();
  const p = s.posts.find(x => x.id === id);
  if (!p) return;
  if (p.meta && !editConfirmed) return metaPost(p);
  ui.editorImage = p.image;
  const metaReady = accountFor(p.platform)?.canPublish;
  const actions = p.meta ? '' : p.status === 'draft'
    ? btn(`${icon('check', 14)}確認內容`, 'post-approve', 'primary', `data-id="${esc(id)}"`)
    : p.status === 'published'
      ? `<span class="badge published">已發布</span>${btn(`${icon('chart', 13)} 填寫成效`, 'metrics-open', 'soft', `data-id="${esc(id)}"`)}`
      : `${btn('標記為已發布', 'post-publish', 'soft', `data-id="${esc(id)}"`)}${btn(`${icon('calendar', 14)}排程發布`, 'post-schedule', 'primary', `data-id="${esc(id)}"`)}`;
  openModal(
    '編輯與確認貼文',
    `<form id="editor-form" data-id="${esc(id)}"><div class="editor-grid"><div><div class="actions" style="margin-bottom:18px">${badge(p.status)}<span class="fine muted">${p.platform === 'instagram' ? 'Instagram' : 'Facebook'} · ${esc(topicLabel(p.topicKey))}${p.engine === 'ai' ? ' · AI 草稿' : ''}</span></div>${p.suggested ? `<div class="notice sea">${icon('bulb', 16)}<span>這是系統在你 ${s.assistant?.idleDays || 3} 天沒發文時準備的草稿，看過、改好再確認就能發。</span></div>` : ''}${trendWarning(p.trend)}${facebookPublishFields(p)}<div class="field"><label for="edit-title">貼文名稱</label><input id="edit-title" value="${esc(p.title)}" required maxlength="100"></div><div class="field"><label for="edit-caption">貼文文案 <button type="button" class="text-link" data-action="caption-copy" style="margin-left:8px">${icon('copy', 12)} 複製文案</button></label><textarea id="edit-caption" class="caption-editor" required maxlength="10000">${esc(p.caption)}</textarea></div><label class="upload-zone">${icon('upload', 20)}<strong>換成自己拍的照片</strong><span class="fine">JPG / PNG / WebP · 上傳前自動壓縮</span><input type="file" id="edit-photo" accept="image/jpeg,image/png,image/webp"></label><div class="field" style="margin-top:17px"><label for="edit-card">照片字卡（選填）</label><input id="edit-card" maxlength="60" placeholder="例如：週六 11:00 校園廣場" value="${esc(p.cardTitle || '')}"><small>字卡會疊在照片上。</small></div><div class="notice" style="margin-bottom:0">${icon('image', 16)}<span>拍照小提醒：靠窗或戶外的自然光最好，餐點從斜上方 45 度拍；備餐的手部特寫也很好用。</span></div></div><div><div class="panel-head"><h3>貼文預覽</h3>${btn(`${icon('download', 12)} 下載發布圖`, 'image-download', 'small', `data-id="${esc(id)}"`)}</div><div class="post-preview"><div class="preview-profile"><span class="preview-avatar">${initial(s.brand.shortName)}</span><span><strong>${esc(handle(s))}</strong><span class="muted">${esc(s.brand.name)}</span></span><span style="margin-left:auto">⋯</span></div><div class="preview-image"><img id="preview-photo" src="${esc(ui.editorImage)}" alt="貼文照片預覽"><div id="preview-card" class="preview-card-overlay" ${p.cardTitle ? '' : 'hidden'}>${esc(p.cardTitle || '')}</div></div><div class="preview-icons">${icon('heart', 19)}${icon('users', 19)}${icon('send', 19)}</div><div class="preview-caption" id="preview-caption">${esc(p.caption)}</div></div><div class="notice sea" style="margin-top:17px">${icon('shield', 16)}<span>${metaReady ? '已連結 Meta，確認後可以直接發布或排程。' : '尚未連結 Meta：確認後複製文案、下載發布圖貼到 IG／FB，再按「標記為已發布」。也可以到工作區設定連結帳號自動發布。'}</span></div></div></div><div class="editor-status"><span class="fine muted" id="editor-hint">${p.status === 'draft' ? '確認後可以發布或排程。' : '已確認的內容再修改，需要重新確認。'}</span></div><div class="modal-actions">${p.meta || p.status === 'published' ? '' : btn(`${icon('trash', 13)} 刪除`, 'post-delete', 'danger', `data-id="${esc(id)}"`)}${btn('關閉', 'modal-close')}<button class="btn" type="submit">儲存草稿</button>${metaReady && ['draft', 'approved'].includes(p.status) ? btn('預覽 Meta 發布版本', 'meta-preview', 'soft', `data-id="${esc(id)}"`) : ''}${actions}</div></form>`,
    { wide: true },
  );
}
function facebookPublishFields(post) {
  if (post.platform !== 'facebook' || !accountFor(post.platform)?.canPublish) return '';
  const kind = post.meta?.kind || 'photo';
  return `<div class="field"><label for="meta-post-kind">Facebook 發布格式</label><select id="meta-post-kind">
    ${[['photo', '照片＋文案'], ['text', '純文字'], ['link', '連結＋文案']].map(([value, label]) =>
      `<option value="${value}"${kind === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
    <div id="meta-post-link-field" ${kind === 'link' ? '' : 'hidden'}><label for="meta-post-link">公開連結</label>
      <input id="meta-post-link" type="url" maxlength="2048" value="${esc(post.meta?.link || '')}" placeholder="https://…"></div></div>`;
}

export async function saveEditor(id) {
  const p = getState().posts.find(p => p.id === id),
    form = document.getElementById('editor-form');
  if (!form || form.dataset.id !== id) return;
  if (form.dataset.uploading === 'true') throw new Error('照片仍在上傳，請完成後再儲存或確認內容。');
  const title = document.getElementById('edit-title').value.trim(),
    caption = document.getElementById('edit-caption').value.trim(),
    cardTitle = document.getElementById('edit-card').value.trim();
  if (!title || !caption) throw new Error('請填寫貼文名稱與文案。');
  if (title !== p.title || caption !== p.caption || ui.editorImage !== p.image || cardTitle !== (p.cardTitle || '')) {
    const result = await dispatch('post.update', { id, title, caption, image: ui.editorImage, cardTitle });
    return result.result?.post?.id || id;
  }
  return id;
}
function metaPost(post) {
  const { meta } = post;
  const target = `data-id="${esc(post.id)}"`;
  const imports = meta.status === 'unknown' ? getState().posts.filter(candidate => {
    const delta = Date.parse(candidate.publishedAt) - Date.parse(meta.attemptedAt);
    return candidate.meta?.imported && candidate.platform === post.platform && candidate.meta.accountId === meta.accountId
      && candidate.caption.trim() === post.caption.trim() && delta >= -300000 && delta <= 86400000;
  }) : [];
  const editable = ['approved', 'failed', 'cancelled'].includes(meta.status);
  const connected = accountFor(post.platform)?.id === meta.accountId && accountFor(post.platform)?.canPublish;
  openModal('Meta 貼文', `
    <p class="notice sea">${esc(metaStatusLabel(post))} · ${esc(platformLabel(post.platform))} · ${esc(meta.accountName)}</p>
    ${meta.error ? `<p class="notice" role="status">${esc(meta.error)}</p>` : ''}
    ${meta.image ? `<div class="preview-image publication-image"><img src="${esc(meta.image)}" alt="已確認的發布用 JPEG"></div>` : ''}
    ${meta.link ? `<p class="body-copy" style="overflow-wrap:anywhere">${esc(meta.link)}</p>` : ''}
    ${meta.status === 'unknown' ? `<p class="body-copy">確認平台上的貼文後，前往資料中心匯入該則貼文，再核對連結與原始發布時間。</p>
      ${imports.map(candidate => `<div class="row-item">${externalPost(candidate)} <span>${dateLabel(candidate.publishedAt, { hour: '2-digit', minute: '2-digit' })}</span>
        ${btn('確認為同一則貼文', 'meta-reconcile', 'small', `${target} data-import-id="${esc(candidate.id)}"`)}</div>`).join('')}` : ''}
    <p class="preview-caption">${esc(post.caption)}</p>${externalPost(post)}
    <div class="modal-actions">${btn('關閉', 'modal-close')}
      ${meta.status === 'queued' ? btn('取消 Meta 排程', 'meta-cancel', 'danger', `${target} data-attempt="${esc(meta.attempt)}"`) : ''}
      ${editable ? btn('修改內容', 'meta-edit', '', target) : ''}
      ${meta.status === 'published' ? btn('建立草稿副本', 'meta-copy', '', target) : ''}
      ${editable && connected ? btn('立即發布至 Meta', 'meta-publish', 'soft', target) + btn('安排 Meta 排程', 'post-schedule', 'primary', target) : ''}
      ${editable && !connected ? '<a class="btn small" href="/settings">前往設定連線</a>' : ''}
    </div>`, { wide: true });
}

export async function showPublicationPreview(id) {
  const editor = document.getElementById('editor-form');
  const post = getState().posts.find(item => item.id === id);
  const account = accountFor(post.platform);
  if (!account?.canPublish) throw new Error('請先在工作區設定選擇可發布的帳號。');
  if (post.platform === 'instagram' && [...post.caption].length > 2200) throw new Error('Instagram 文案最多 2,200 字元。');
  const content = { caption: post.caption, image: post.image, cardTitle: post.cardTitle };
  const kind = post.platform === 'facebook' ? editor?.querySelector('#meta-post-kind')?.value || 'photo' : 'photo';
  let link = '';
  if (kind === 'link') {
    try {
      const target = new URL(editor.querySelector('#meta-post-link').value.trim());
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error();
      link = target.href;
    } catch { throw new Error('請填寫有效的 HTTPS 貼文連結。'); }
  }
  const blob = kind === 'photo' ? await publicationJpeg(content.image, content.cardTitle) : null;
  if (document.getElementById('editor-form') !== editor) return;
  const url = blob ? URL.createObjectURL(blob) : '';
  openModal('確認 Meta 發布版本', `<div class="notice sea">${esc(platformLabel(post.platform))} · ${esc(account.name)} (${esc(account.id)})</div>
    <p class="body-copy">確認以下發布內容後，可選擇立即發布或排程。</p>
    ${url ? `<div class="preview-image publication-image"><img src="${url}" alt="實際發布用 JPEG"></div>` : ''}
    ${link ? `<p class="body-copy" style="overflow-wrap:anywhere">${esc(link)}</p>` : ''}
    <p class="preview-caption">${esc(content.caption)}</p>
    <div class="modal-actions">${btn('返回編輯', 'meta-preview-back', '', `data-id="${esc(id)}"`)}${btn('確認發布版本', 'meta-approve', 'primary')}</div>`, { wide: true });
  preview = { id, accountId: account.id, content, kind, link, blob, url };
}

export function publishModal(id) {
  const p = getState().posts.find(post => post.id === id);
  openModal('標記為已發布', `<p class="body-copy">尚未連結 Meta 時，請先把文案與發布圖貼到 ${p.platform === 'instagram' ? 'Instagram' : 'Facebook'}，再回來標記。標記後可以在「貼文成效」填寫觸及、按讚等數字。</p>
    <div class="actions" style="margin-top:14px">${btn(`${icon('copy', 13)} 複製文案`, 'caption-copy-saved', 'small', `data-id="${esc(id)}"`)}${btn(`${icon('download', 13)} 下載發布圖`, 'image-download', 'small', `data-id="${esc(id)}"`)}</div>
    <div class="modal-actions">${btn('返回', 'post-edit', '', `data-id="${esc(id)}"`)}${btn('已經發出去了，標記為已發布', 'post-publish-confirm', 'primary', `data-id="${esc(id)}"`)}</div>`);
}

export function metricsModal(id) {
  const p = getState().posts.find(post => post.id === id);
  if (!p) return;
  const m = p.metrics || {};
  const field = (key, label) => `<div class="field"><label for="metric-${key}">${label}</label><input id="metric-${key}" type="number" min="0" max="100000000" step="1" value="${m[key] ?? ''}" placeholder="0"></div>`;
  openModal('填寫貼文成效', `<form id="metrics-form" data-id="${esc(id)}"><p class="body-copy" style="margin-bottom:16px">「${esc(p.title)}」· 打開 ${p.platform === 'instagram' ? 'Instagram 洞察報告' : 'Facebook 專業主控板'}，把數字填在這裡。</p>
    <div class="grid cols-2 form-grid">${field('reach', '觸及人數')}${field('likes', '按讚')}${field('comments', '留言')}${field('saves', '收藏／分享')}${field('clicks', '連結點擊')}</div>
    <div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit">儲存成效</button></div></form>`);
}

export function scheduleModal(id) {
  const p = getState().posts.find(p => p.id === id);
  if (p.status !== 'approved' && p.status !== 'scheduled') throw new Error('內容已修改，請先重新確認。');
  const d = new Date(Date.now() + 86400000).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16).replace(' ', 'T');
  openModal(
    '安排貼文排程',
    `<form id="schedule-form" data-id="${esc(id)}" data-version="${esc(p.meta?.version || '')}"><div class="notice sea">${icon('check', 16)}已確認：${esc(p.title)}${p.meta ? ` · ${esc(platformLabel(p.platform))} · ${esc(p.meta.accountName)}` : ''}</div><div class="field"><label for="schedule-at">發布日期與時間（台灣時間）</label><input type="datetime-local" id="schedule-at" value="${esc(d)}" required><small>只能選未來的時間。${p.meta ? `時間到會由工作台發布至 ${esc(p.meta.accountName)}，瀏覽器可關閉。` : '排程會顯示在行事曆；尚未連結 Meta 時，時間到請自行發布後標記。'}</small></div>${labelField(defaultLabel(getState(), 'post', p))}<div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit">${icon('calendar', 14)}確認排程</button></div></form>`,
  );
}
/** Add or edit a custom calendar label (the built-in 出攤／貼文 stay as they are). */
export function labelModal(id = '') {
  const label = id ? allLabels().find(row => row.id === id) : null;
  openModal(label ? '編輯行事曆標籤' : '新增行事曆標籤', `<form id="label-form" data-id="${esc(label?.id || '')}"><div class="field"><label for="label-form-name">類型名稱</label><input id="label-form-name" required maxlength="8" value="${esc(label?.name || '')}" placeholder="例如：節慶活動"></div><div class="field"><label>顏色</label>${swatches(label?.color || 'blue', 'label-form-color')}</div><p class="fine muted">刪除標籤後，用過它的貼文和出攤會改回預設的顏色。</p><div class="modal-actions">${label ? btn(`${icon('trash', 13)} 刪除`, 'label-delete', 'danger', `data-id="${esc(label.id)}"`) : ''}${btn('取消', 'modal-close')}<button class="btn primary" type="submit">儲存</button></div></form>`);
}
export function stallModal(id, date = '') {
  const e = getState().stalls.find(x => x.id === id);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  openModal(
    e ? '編輯出攤' : '新增出攤',
    `<form id="stall-form" data-id="${esc(id || '')}"><div class="field"><label for="stall-title">出攤名稱</label><input id="stall-title" required maxlength="100" placeholder="例如：週六信義市集" value="${esc(e?.title || '')}"></div><div class="field"><label for="stall-date">日期</label><input type="date" id="stall-date" required value="${esc(e?.date || today)}"></div><div class="grid cols-2 form-grid"><div class="field"><label for="stall-start">開始時間</label><input type="time" id="stall-start" required value="${esc(e?.start || '11:00')}"></div><div class="field"><label for="stall-end">結束時間</label><input type="time" id="stall-end" required value="${esc(e?.end || '18:00')}"></div></div><div class="field"><label for="stall-location">出攤地點</label><input id="stall-location" required maxlength="200" value="${esc(e?.location || '')}" placeholder="場地名稱或地址"></div><div class="field"><label for="stall-notes">備註</label><textarea id="stall-notes" maxlength="1000" style="min-height:70px" placeholder="例如：停車位置、需要準備的份量">${esc(e?.notes || '')}</textarea></div>${labelField(defaultLabel(getState(), 'stall', e))}<div class="modal-actions">${e ? btn('刪除出攤', 'stall-delete', 'danger', `data-id="${esc(id)}"`) : ''}${btn('取消', 'modal-close')}<button class="btn primary" type="submit">儲存出攤</button></div></form>`,
  );
}

export function brandModal() {
  const b = getState().brand;
  const field = (id, label, value, max, extra = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" maxlength="${max}" value="${esc(value || '')}" ${extra}></div>`;
  openModal('編輯品牌資料', `<form id="brand-form"><div class="grid cols-2 form-grid">${field('brand-name', '店名（帳號名稱）', b.name, 60, 'required')}${field('brand-short', '簡稱（12 字內）', b.shortName, 12, 'required')}</div>
    <div class="grid cols-2 form-grid">${field('brand-tagline', '標語', b.tagline, 40, 'placeholder="例如：共融就業餐車"')}${field('brand-location', '主要出攤地區', b.location, 60)}</div>
    <div class="field"><label for="brand-description">品牌介紹</label><textarea id="brand-description" maxlength="1000" style="min-height:90px">${esc(b.description || '')}</textarea><small>會顯示在顧客點餐頁，也會給 AI 寫貼文參考。</small></div>
    <div class="grid cols-2 form-grid">${field('brand-name-en', '英文店名', b.nameEn, 60)}${field('brand-instagram', 'Instagram 網址', b.instagram, 300, 'type="url" placeholder="https://www.instagram.com/…"')}</div>
    <div class="field"><label for="brand-description-en">英文介紹</label><textarea id="brand-description-en" maxlength="1000" style="min-height:70px">${esc(b.descriptionEn || '')}</textarea></div>
    ${field('brand-website', '官網網址', b.website, 300, 'type="url" placeholder="https://"')}
    <div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit">儲存品牌資料</button></div></form>`, { wide: true });
}
export function passwordModal() {
  openModal('變更密碼', `<form id="password-form"><div class="field"><label for="password-current">目前密碼</label><input id="password-current" type="password" required maxlength="128" autocomplete="current-password"></div>
    <div class="field"><label for="password-next">新密碼（至少 8 個字元）</label><input id="password-next" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></div>
    <div class="field"><label for="password-confirm">再輸入一次新密碼</label><input id="password-confirm" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></div>
    <p class="fine muted">變更後，其他裝置上這台餐車的登入會被登出。</p><div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit">更新密碼</button></div></form>`);
}
export function memberSettingsModal() {
  const s = getState().settings;
  const r = s.rfm;
  const field = (id, label, value, min, max, note = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" min="${min}" max="${max}" required value="${value}">${note ? `<small>${note}</small>` : ''}</div>`;
  openModal('會員設定', `<form id="member-settings-form">${field('set-reward', '會員資料完成禮（NT$）', s.profileReward, 0, 1000, '會員填完性別、出生年、縣市、職業、收入後自動送出；0 表示不送。')}
    <h3 class="section-title">RFM 分群條件</h3><div class="grid cols-2 form-grid">${field('set-loyal', '常來客：消費次數至少', r.loyalOrders, 2, 50)}${field('set-active', '常來客：最近幾天內有消費', r.activeDays, 7, 180)}${field('set-churn', '流失客：幾天以上沒消費', r.churnDays, 14, 365)}${field('set-big', '潛在客：上次消費滿（NT$）', r.bigOrder, 1, 100000)}</div>
    <div class="modal-actions">${btn('取消', 'modal-close')}<button class="btn primary" type="submit">儲存設定</button></div></form>`);
}
export const formatMoney = money;
