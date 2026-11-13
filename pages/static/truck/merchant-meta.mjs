
import { esc, icon, metaRequest } from './client.mjs';

const labels = { instagram: 'Instagram', facebook: 'Facebook 粉專' };
const statusLabels = {
  approved: '已確認發布版本', queued: '已排程', publishing: '正在發送至 Meta',
  published: '已發布至 Meta', failed: '發布失敗', unknown: '發布結果待查證', cancelled: '排程已取消',
};
const notices = {
  choose: 'Meta 授權完成，請選擇工作台要使用的帳號。',
  cancelled: '已取消 Meta 授權。',
  invalid: '這次授權已失效，請重新連線。',
  'no-assets': 'Meta 未提供可使用的專業帳號或粉專。請確認商務資產與管理權。',
  error: 'Meta 授權未完成。請確認應用程式設定、授權權限與回呼網址。',
};
let status = null;
let loadError = false;

export const platformLabel = platform => labels[platform] || platform;
export const metaStatus = () => status;
export const accountFor = platform => {
  const value = status?.platforms?.[platform];
  return value?.state === 'connected' ? value.account : null;
};
export const merchantProtected = () => status?.protected === true;
export const metaStatusLabel = post => post.meta?.imported ? 'Meta 匯入' : statusLabels[post.meta?.status];
export const postBadge = (post, badge) => post.meta
  ? `<span class="badge ${post.status}">${esc(metaStatusLabel(post) || 'Meta 貼文')}</span>`
  : badge(post.status);
export const externalPost = post => post.meta?.permalink
  ? `<a class="text-link" href="${esc(post.meta.permalink)}" target="_blank" rel="noopener noreferrer">查看原貼文 ${icon('external-link', 13)}</a>` : '';

export async function refreshMeta() {
  try {
    status = await metaRequest('status');
    loadError = false;
  } catch (error) {
    loadError = true;
    if (error.status === 401) throw error;
  }
  return status;
}

export function metaSettings() {
  const note = notices[new URLSearchParams(location.search).get('meta')];
  const panels = Object.entries(labels).map(([platform, label]) => {
    const row = status?.platforms?.[platform];
    const canConnect = row?.configured;
    const detail = row?.state === 'connected'
      ? `${esc(row.account.name)} · ${[row.account.canImport && '匯入', row.account.canPublish && '發布', row.account.canReadInsights && '成效'].filter(Boolean).join('、') || '缺少可用權限'}`
      : row?.state === 'reauthorize' ? '授權已過期或設定變更，請重新連線。'
        : canConnect ? '請使用具有資產管理權的 Meta 帳號連線。' : '等待設定 Meta 應用程式與授權配置。';
    const target = `data-platform="${platform}"`;
    return `<div class="setting-row"><div><h3>${label}</h3><p>${detail}</p></div><div class="actions">
      ${canConnect ? `<button class="btn small" data-action="meta-connect" ${target}>${row.account ? '重新連線' : '連線'}</button>` : ''}
      ${row?.account ? `<button class="btn small danger" data-action="meta-disconnect" ${target}>解除連線</button>` : ''}
      </div></div>${row?.candidates?.length ? `<form class="meta-select-form field" ${target}>
      <label for="meta-account-${platform}">選擇 ${label} 帳號</label>
      <select id="meta-account-${platform}" name="accountId" required>${row.candidates.map(asset =>
        `<option value="${esc(asset.id)}">${esc(asset.name)} (${esc(asset.id)})${asset.canPublish ? '' : ' · 缺少發布權限'}</option>`).join('')}</select>
      <button class="btn small primary" type="submit">使用此帳號</button></form>` : ''}`;
  }).join('');
  return `<section class="panel"><div class="panel-head"><h2>Meta 社群連線</h2>${icon('link', 18)}</div>
    ${note ? `<p class="notice" role="status">${esc(note)}</p>` : ''}
    ${loadError ? '<p class="body-copy" role="alert">暫時無法取得連線狀態。</p><button class="btn small" data-action="meta-refresh">重新讀取</button>' : ''}
    ${panels}
  </section>`;
}

export function metaImportPanel(state) {
  const imported = state.posts.filter(post => post.meta?.imported);
  const buttons = Object.entries(labels).filter(([platform]) => accountFor(platform)?.canImport).map(([platform, label]) => {
    const more = status.platforms[platform].morePosts;
    return `<button class="btn small soft" data-action="meta-import" data-platform="${platform}" data-restart="true">匯入最新 ${label} 貼文</button>
      ${more ? `<button class="btn small" data-action="meta-import" data-platform="${platform}">匯入較早的 ${label} 貼文</button>` : ''}`;
  }).join('');
  return `<section class="panel section-space"><div class="panel-head"><h2>Meta 既有貼文 <span class="badge neutral">${imported.length} 則</span></h2></div>
    <p class="body-copy">匯入所選帳號的既有貼文。Brand DNA 會參考匯入的文案。</p>
    <div class="actions">${buttons || '<a class="btn small" href="/settings">前往連線 Meta</a>'}</div>
    ${imported.map(post => `<div class="row-item"><div class="row-main"><strong>${esc(post.title)}</strong>
      <p>${esc(platformLabel(post.platform))} · ${esc(post.meta.accountName)} · ${esc(dateTime(post.publishedAt))}</p></div>${post.meta.thumbnail ? `<a class="text-link" href="${esc(post.meta.thumbnail)}" target="_blank" rel="noopener noreferrer">原圖</a>` : ''}${externalPost(post)}</div>`).join('')}
  </section>`;
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '尚未同步';
}

export function metaAnalytics(state) {
  const posts = state.posts.filter(post => post.mode === 'meta' && post.meta?.remoteId);
  if (!posts.length && !accountFor('instagram') && !accountFor('facebook')) return '';
  const known = value => typeof value === 'number' ? value.toLocaleString('zh-TW') : '—';
  const keys = ['reach', 'likes', 'comments', 'saves', 'views', 'shares'];
  const hasNumbers = posts.some(post => keys.some(key => typeof post.metrics?.[key] === 'number'));
  const canSync = posts.some(post => accountFor(post.platform)?.id === post.meta.accountId && accountFor(post.platform)?.canReadInsights);
  return `<section class="panel section-space" style="margin-bottom:20px"><div class="panel-head"><h2>Meta 貼文成效</h2><div class="actions">
      <button class="btn small soft" data-action="meta-sync" ${canSync ? '' : 'disabled'}>同步成效</button>
      <button class="btn small primary" data-action="meta-feedback" ${hasNumbers ? '' : 'disabled'}>加入資料中心</button>
    </div></div>
    <p class="body-copy">每則顯示 Meta 累計指標與最近讀取時間。— 表示尚未取得或不適用。Facebook 觸及採用獨立瀏覽人數，每篇 CTA 點擊暫無對應指標。</p>
    ${posts.length ? `<div class="wide-table"><table class="source-table"><thead><tr><th>貼文與帳號</th><th>觸及</th><th>按讚</th><th>留言</th><th>收藏</th><th>瀏覽</th><th>分享</th><th>資料更新</th></tr></thead>
      <tbody>${posts.map(post => `<tr><td><button class="text-link" data-action="post-edit" data-id="${esc(post.id)}">${esc(post.title)}</button>
      <small class="muted" style="display:block">${esc(platformLabel(post.platform))} · ${esc(post.meta.accountName)}</small></td>
      ${keys.map(key => `<td>${known(post.metrics?.[key])}</td>`).join('')}
      <td>${esc(dateTime(post.metrics?.fetchedAt))}<small class="muted" style="display:block">${esc(post.meta.insightsError || post.metrics?.reason || '')}</small></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">連線後匯入既有貼文，或發布新貼文以讀取成效。</p>'}</section>`;
}

export async function publicationJpeg(imageUrl, title) {
  if (!imageUrl) throw new Error('請先上傳發布照片。');
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = imageUrl;
  try { await image.decode(); } catch { throw new Error('照片無法讀取，請重新上傳圖片。'); }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1080;
  const ctx = canvas.getContext('2d', { alpha: false });
  const size = Math.min(image.naturalWidth, image.naturalHeight);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1080, 1080);
  ctx.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 1080, 1080);
  if (title) {
    await document.fonts?.load('700 46px "Noto Sans TC"', title).catch(() => {});
    ctx.font = '700 46px "Noto Sans TC", sans-serif';
    const lines = [];
    let line = '';
    for (const char of title) {
      if (ctx.measureText(line + char).width > 880) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
    const y = 1016 - lines.length * 60;
    ctx.fillStyle = 'rgba(20, 48, 45, 0.9)';
    ctx.fillRect(64, y - 20, 952, lines.length * 60 + 32);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    lines.forEach((text, index) => ctx.fillText(text, 100, y + index * 60, 880));
  }
  const blob = await new Promise((resolve, reject) => {
    try { canvas.toBlob(resolve, 'image/jpeg', 0.9); } catch { reject(new Error('照片無法合成，請上傳照片後再試。')); }
  });
  if (!blob || blob.type !== 'image/jpeg') throw new Error('無法產生發布用 JPEG。');
  return blob;
}
