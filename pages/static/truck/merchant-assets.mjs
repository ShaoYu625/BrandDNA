// 顧客點餐 QR Code 素材: the merchant downloads files to show customers (print, table cards, social posts).
import qrcode from './vendor/qrcode.mjs';
import { esc, icon } from './client.mjs';
import { orderUrl, downloadBlob, btn } from './merchant-ui.mjs';

function matrix(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}
export function fillQR() {
  for (const el of document.querySelectorAll('[data-qr]')) {
    const qr = matrix(el.dataset.qr || orderUrl());
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
}
export function assetKit(state) {
  const url = orderUrl();
  const name = state.brand?.name || '我的餐車';
  return `<details class="panel asset-kit" id="asset-kit"><summary><span class="row-icon">${icon('qr', 17)}</span><span class="asset-summary"><strong>顧客點餐 QR Code 素材</strong><small>下載要給顧客掃描的 QR Code、海報與桌卡，或複製點餐連結</small></span><span class="asset-chevron">${icon('down', 14)}</span></summary>
    <div class="asset-body"><div class="asset-preview"><div class="qr-frame" data-qr="${esc(url)}" aria-label="${esc(name)} 點餐 QR Code"></div><p class="fine muted">預覽（實際下載為高解析度）</p></div>
    <div class="asset-actions"><div class="asset-link"><label for="order-link">顧客點餐連結</label><div class="copy-row"><input id="order-link" readonly value="${esc(url)}">${btn(`${icon('copy', 13)} 複製`, 'copy-link', 'small')}</div><small>可以放在 IG／FB 個人簡介、Google 商家或 LINE 官方帳號。</small></div>
      <div class="asset-grid">
        ${[['png', 'QR Code 圖檔', 'PNG・1024 px・白底', 'image'], ['svg', 'QR Code 向量檔', 'SVG・印刷放大不失真', 'qr'], ['poster', 'A5 點餐海報', 'PNG・含店名與說明，貼在餐車上', 'book'], ['card', '方形桌卡／貼文圖', 'PNG・1080 px，可直接發 IG', 'grid']].map(([kind, title, note, i]) => `<button class="asset-tile" data-action="asset-download" data-kind="${kind}"><span>${icon(i, 18)}</span><strong>${title}</strong><small>${note}</small>${icon('download', 14)}</button>`).join('')}
      </div><a class="text-link" href="${esc(url.replace(location.origin, ''))}" target="_blank" rel="noopener">${icon('external-link', 12)} 開啟顧客點餐頁</a></div></div></details>`;
}

function drawQr(ctx, qr, x, y, size) {
  const count = qr.getModuleCount();
  const cell = size / count;
  ctx.fillStyle = '#14353b';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect(Math.floor(x + c * cell), Math.floor(y + r * cell), Math.ceil(cell), Math.ceil(cell));
}
function canvas(width, height, background) {
  const el = document.createElement('canvas');
  el.width = width; el.height = height;
  const ctx = el.getContext('2d');
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  return { el, ctx };
}
function roundRect(ctx, x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
function centerText(ctx, text, y, font, color, maxWidth) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, ctx.canvas.width / 2, y, maxWidth);
}
const toBlob = el => new Promise(resolve => el.toBlob(resolve, 'image/png'));
const fileName = (state, suffix) => `${(state.brand?.shortName || 'truck').replace(/[\\/:*?"<>|\s]+/g, '')}-${suffix}`;

export async function downloadAsset(kind, state) {
  const url = orderUrl();
  const qr = matrix(url);
  const name = state.brand?.name || '我的餐車';
  if (kind === 'svg') {
    const svg = qr.createSvgTag({ cellSize: 10, margin: 4, scalable: false }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    return downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), fileName(state, 'qr.svg'));
  }
  await document.fonts?.load('800 80px "Noto Sans TC"', name).catch(() => {});
  const font = (weight, size) => `${weight} ${size}px "Noto Sans TC", "DM Sans", sans-serif`;
  if (kind === 'png') {
    const { el, ctx } = canvas(1024, 1024, '#ffffff');
    drawQr(ctx, qr, 64, 64, 896);
    return downloadBlob(await toBlob(el), fileName(state, 'qr.png'));
  }
  if (kind === 'card') {
    const { el, ctx } = canvas(1080, 1080, '#fbf6e8');
    roundRect(ctx, 60, 60, 960, 960, 48, '#174c56');
    centerText(ctx, name, 190, font(800, 64), '#fffdf2', 880);
    roundRect(ctx, 250, 250, 580, 580, 32, '#ffffff');
    drawQr(ctx, qr, 285, 285, 510);
    centerText(ctx, '掃碼線上點餐 · Scan to order', 920, font(700, 46), '#f4e8cb', 900);
    return downloadBlob(await toBlob(el), fileName(state, 'card.png'));
  }
  // A5 portrait at 300 dpi.
  const { el, ctx } = canvas(1748, 2480, '#fbf6e8');
  ctx.fillStyle = '#174c56'; ctx.fillRect(0, 0, 1748, 520);
  centerText(ctx, name, 250, font(800, 112), '#fffdf2', 1500);
  centerText(ctx, state.brand?.tagline || '行動餐車 · 線上點餐', 380, font(500, 56), '#bcd3c4', 1500);
  centerText(ctx, '掃碼線上點餐', 760, font(900, 150), '#174c56', 1600);
  centerText(ctx, '先在手機點好，到餐車直接取餐', 880, font(500, 64), '#5c6f5a', 1600);
  roundRect(ctx, 334, 980, 1080, 1080, 56, '#ffffff');
  drawQr(ctx, qr, 394, 1040, 960);
  centerText(ctx, 'Scan to order ahead · Pick up at the truck', 2190, font(600, 54), '#e07a50', 1600);
  centerText(ctx, url.replace(/^https?:\/\//, ''), 2300, font(500, 40), '#7f8a78', 1600);
  return downloadBlob(await toBlob(el), fileName(state, 'poster-a5.png'));
}
