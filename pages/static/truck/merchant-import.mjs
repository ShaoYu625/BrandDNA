// 資料中心「新增品牌資料」區塊：手動輸入、官網 HTML、圖片文字辨識、批次貼上、多個檔案，直接放在頁面上。
// 頁面會因即時更新整頁重畫，所以輸入中的內容存在 ui.importDraft，已選的檔案先解析成文字存在 ui，重畫後不會消失。
import { esc, icon } from './client.mjs';
import { ui, btn } from './merchant-ui.mjs';
import { SOURCE_TYPES } from './merchant-modals.mjs';

export const IMPORT_TABS = [['manual', 'pen', '手動輸入'], ['html', 'globe', '官網 HTML'], ['ocr', 'image', '圖片文字辨識'], ['batch', 'copy', '批次貼上'], ['files', 'upload', '多個檔案']];
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_CONTENT = 19000;

export const draft = () => (ui.importDraft ||= { manualTitle: '', manualType: 'brand', manualContent: '', batchText: '', batchType: 'instagram', batchPrefix: '社群貼文', filesType: 'manual', htmlType: 'website', ocrTitle: '', ocrType: 'menu', ocrHint: '' });
export function resetDraft(tab) {
  const d = draft();
  if (tab === 'manual') Object.assign(d, { manualTitle: '', manualContent: '' });
  if (tab === 'batch') d.batchText = '';
  if (tab === 'ocr') Object.assign(d, { ocrTitle: '', ocrHint: '' });
  if (tab === 'html') ui.htmlFiles = [];
  if (tab === 'files') ui.importFiles = [];
  if (tab === 'ocr') ui.ocrImage = null;
}
const typeOptions = (selected, types = SOURCE_TYPES.slice(0, 7)) => types.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
const sizeLabel = chars => chars >= 1000 ? `${(chars / 1000).toFixed(1)}k 字` : `${chars} 字`;

/** Splits pasted text into posts on lines that contain only ---. */
export function splitBatch(value) {
  return String(value || '').split(/^\s*-{3,}\s*$/m).map(part => part.trim()).filter(Boolean).slice(0, 20);
}

function manualPane(d) {
  return `<form id="add-manual-form" class="import-pane"><div class="grid cols-2 form-grid"><div class="field"><label for="add-title">資料名稱</label><input id="add-title" data-draft="manualTitle" required maxlength="100" value="${esc(d.manualTitle)}" placeholder="例如：品牌故事、餐點介紹"></div><div class="field"><label for="add-type">來源類型</label><select id="add-type" data-draft="manualType">${typeOptions(d.manualType)}</select></div></div>
    <div class="field"><label for="add-content">品牌內容／來源摘要</label><textarea id="add-content" data-draft="manualContent" required maxlength="20000" placeholder="貼上品牌介紹、既有社群文案或餐點特色…">${esc(d.manualContent)}</textarea><small>品牌診斷會參考這段文字。也可以<label class="text-link inline-file">選一個文字檔或圖片<input id="add-file" type="file" accept=".txt,.md,.csv,.json,image/jpeg,image/png,image/webp" hidden></label>帶入內容。</small></div>
    <div class="modal-actions"><button type="submit" class="btn primary">${icon('plus', 13)} 新增資料</button></div></form>`;
}
function htmlPane(d) {
  const files = ui.htmlFiles || [];
  const ok = files.filter(file => !file.error);
  return `<form id="import-html-form" class="import-pane"><div class="html-import">
    <aside class="howto-card" aria-label="取得官網 HTML 的三個步驟"><span class="eyebrow muted">HOW TO</span><h3>三步驟取得官網 HTML</h3><ol>
      <li><b>1</b><div><strong>用電腦打開官網</strong><p>開到想匯入的那一頁，例如「關於我們」或「菜單」。</p></div></li>
      <li><b>2</b><div><strong>按 <kbd>Ctrl</kbd> + <kbd>S</kbd> 存檔</strong><p>Mac 按 <kbd>⌘</kbd> + <kbd>S</kbd>。存檔類型選「網頁，完整」，存到桌面。</p></div></li>
      <li><b>3</b><div><strong>把 .html 檔拖進右邊</strong><p>同時產生的資料夾不用上傳。想匯入多頁就重複 1、2，再一次選多個檔案。</p></div></li></ol>
      <p class="fine muted">手機沒辦法另存網頁，請用電腦操作。</p></aside>
    <div><label class="upload-zone" for="import-html-files">${icon('upload', 20)}<strong>選擇或拖進 .html 檔</strong><span class="fine">可一次選多個 · 每個 5 MB 內 · 最多 20 個</span><input type="file" id="import-html-files" accept=".html,.htm,text/html" multiple></label>
      ${files.length ? `<ul class="html-preview">${files.map((file, index) => `<li class="${file.error ? 'error' : ''}"><div><strong>${esc(file.title || file.name)}</strong><small>${esc(file.name)}${file.error ? '' : ` · ${sizeLabel(file.content.length)}${file.url ? ` · ${esc(file.url)}` : ''}`}</small><p>${esc(file.error || `${file.content.replace(/^來源網址：.*\n+/, '').slice(0, 140)}…`)}</p></div>${btn(icon('close', 12), 'html-remove', 'small', `data-index="${index}" aria-label="移除 ${esc(file.name)}"`)}</li>`).join('')}</ul>` : ''}
      <div class="field" style="margin-top:14px"><label for="import-html-type">來源類型</label><select id="import-html-type" data-draft="htmlType">${typeOptions(d.htmlType)}</select></div>
      <div class="modal-actions"><button class="btn primary" type="submit" ${ok.length ? '' : 'disabled'}>${icon('download', 13)} 匯入 ${ok.length || ''} 個網頁</button></div></div></div></form>`;
}
function ocrPane(d) {
  const aiReady = ui.ai?.enabled;
  return `<form id="import-ocr-form" class="import-pane">${aiReady ? '' : `<div class="notice">${icon('info', 16)}<span>圖片文字辨識需要啟用 AI 助理（工作區設定 → AI 助理）。</span></div>`}<label class="upload-zone" for="import-ocr-file">${icon('image', 20)}<strong>選擇菜單、海報或社群截圖</strong><span class="fine">JPG / PNG / WebP · 上傳前自動壓縮</span><input type="file" id="import-ocr-file" accept="image/jpeg,image/png,image/webp"></label>${ui.ocrImage ? `<div class="ocr-preview"><img src="${esc(ui.ocrImage)}" alt="要辨識的圖片"></div>` : ''}<div class="grid cols-2 form-grid" style="margin-top:14px"><div class="field"><label for="import-ocr-title">資料名稱（選填）</label><input id="import-ocr-title" data-draft="ocrTitle" maxlength="100" value="${esc(d.ocrTitle)}" placeholder="例如：2025 冬季菜單"></div><div class="field"><label for="import-ocr-type">來源類型</label><select id="import-ocr-type" data-draft="ocrType">${typeOptions(d.ocrType, [['menu', '餐點資料'], ['instagram', 'Instagram 貼文'], ['manual', '手動文字']])}</select></div></div><div class="field"><label for="import-ocr-hint">補充說明（選填）</label><input id="import-ocr-hint" data-draft="ocrHint" maxlength="200" value="${esc(d.ocrHint)}" placeholder="例如：這是手寫的價目表"></div><div class="modal-actions"><button class="btn primary" type="submit" ${aiReady && ui.ocrImage ? '' : 'disabled'}>${icon('sparkles', 13)} 辨識並匯入</button></div></form>`;
}
function batchPane(d) {
  const count = splitBatch(d.batchText).length;
  return `<form id="import-batch-form" class="import-pane"><div class="field"><label for="import-batch-text">貼上多篇內容</label><textarea id="import-batch-text" data-draft="batchText" required maxlength="60000" style="min-height:200px" placeholder="每篇之間用一行 --- 分隔，例如：&#10;第一篇貼文內容…&#10;---&#10;第二篇貼文內容…">${esc(d.batchText)}</textarea><small id="import-batch-count">${count ? `將匯入 ${count} 筆資料（最多 20 筆）。` : '每篇之間用單獨一行「---」分隔，最多 20 篇。'}</small></div><div class="grid cols-2 form-grid"><div class="field"><label for="import-batch-type">來源類型</label><select id="import-batch-type" data-draft="batchType">${typeOptions(d.batchType, [['instagram', 'Instagram 貼文'], ['facebook', 'Facebook 貼文'], ['manual', '手動文字'], ['menu', '餐點資料']])}</select></div><div class="field"><label for="import-batch-prefix">名稱開頭</label><input id="import-batch-prefix" data-draft="batchPrefix" maxlength="40" value="${esc(d.batchPrefix)}"></div></div><div class="modal-actions"><button class="btn primary" type="submit">匯入全部</button></div></form>`;
}
function filesPane(d) {
  const files = ui.importFiles || [];
  return `<form id="import-files-form" class="import-pane"><label class="upload-zone" for="import-files">${icon('upload', 20)}<strong>選擇一或多個文字檔</strong><span class="fine">.txt .md .csv .json · 每個檔案 1 MB 內，最多 20 個</span><input type="file" id="import-files" accept=".txt,.md,.csv,.json" multiple></label><p class="fine muted" id="import-files-count" style="margin-top:10px">${files.length ? `已選擇 ${files.length} 個檔案：${esc(files.map(file => file.name).join('、'))}` : '每個檔案會成為一筆品牌資料。'}</p><div class="field" style="margin-top:12px"><label for="import-files-type">來源類型</label><select id="import-files-type" data-draft="filesType">${typeOptions(d.filesType)}</select></div><div class="modal-actions"><button class="btn primary" type="submit" ${files.length ? '' : 'disabled'}>匯入檔案</button></div></form>`;
}

export function importPanel() {
  const tab = IMPORT_TABS.some(([key]) => key === ui.importTab) ? ui.importTab : 'manual';
  const d = draft();
  const panes = { manual: manualPane, html: htmlPane, ocr: ocrPane, batch: batchPane, files: filesPane };
  return `<section class="panel import-panel" id="import"><div class="panel-head"><div><span class="eyebrow muted">ADD DATA</span><h2>${icon('plus', 16)} 新增品牌資料</h2></div><span class="muted fine">新增後按「分析」，再到品牌診斷重新建立</span></div>
    <div class="tabs" role="tablist" aria-label="新增方式">${IMPORT_TABS.map(([key, i, label]) => `<button type="button" role="tab" aria-selected="${key === tab}" class="tab ${key === tab ? 'active' : ''}" data-action="import-tab" data-tab="${key}">${icon(i, 14)} ${label}</button>`).join('')}</div>${panes[tab](d)}</section>`;
}

// --- Reading saved web pages in the browser (nothing is fetched from the merchant's website) ---
function decode(buffer) {
  const head = new TextDecoder('windows-1252').decode(buffer.slice(0, 4096));
  const declared = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
  for (const charset of [declared, 'utf-8'].filter(Boolean)) {
    try { return new TextDecoder(charset).decode(buffer); } catch { /* unknown label: try the next */ }
  }
  return new TextDecoder().decode(buffer);
}
const squeeze = value => String(value || '').replace(/[ \t\f\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
/** Readable text of a saved page: title, description and body text without menus, scripts and forms. */
export function htmlToSource(html, fileName = '') {
  const savedFrom = /<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i.exec(html)?.[1] || '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const attr = (selector, name) => doc.querySelector(selector)?.getAttribute(name)?.trim() || '';
  const url = [savedFrom, attr('link[rel="canonical"]', 'href'), attr('meta[property="og:url"]', 'content')].find(value => /^https?:\/\//i.test(value)) || '';
  const title = squeeze(attr('meta[property="og:title"]', 'content') || doc.title || '').slice(0, 80);
  const description = squeeze(attr('meta[name="description"]', 'content') || attr('meta[property="og:description"]', 'content'));
  doc.querySelectorAll('script,style,noscript,template,svg,iframe,canvas,form,button,select,nav,footer,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  const main = [...doc.querySelectorAll('main,article,[role="main"]')].sort((a, b) => b.textContent.length - a.textContent.length)[0];
  const root = main && main.textContent.trim().length > 200 ? main : doc.body;
  if (!root) return { title, url, content: '', error: '這個檔案不是網頁。' };
  root.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  root.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,section,article,header,blockquote,dd,dt,figcaption').forEach(node => node.append('\n'));
  // Menus and repeated banners show up as the same short line many times; keep each line once.
  const seen = new Set();
  const body = squeeze(root.textContent).split('\n').filter(line => { const key = line.trim(); if (!key) return true; if (key.length < 40 && seen.has(key)) return false; seen.add(key); return true; }).join('\n').replace(/\n{3,}/g, '\n\n');
  const text = [description, body].filter(Boolean).join('\n\n');
  // A short page (one sentence) is still worth importing; only a page with essentially no text is refused.
  if (text.replace(/\s/g, '').length < 8) return { title, url, content: '', error: '讀不到文字。這個網頁可能是開啟後才載入內容，請在網頁完全顯示後再存一次（存檔類型選「網頁，完整」），或複製網頁文字改用「手動輸入」。' };
  const label = title || (url ? new URL(url).hostname.replace(/^www\./, '') : fileName.replace(/\.html?$/i, ''));
  return { title: `網站｜${label}`.slice(0, 100), url, content: `${url ? `來源網址：${url}\n\n` : ''}${text}`.slice(0, MAX_CONTENT), error: '' };
}
export async function readHtmlFiles(fileList) {
  const files = [...fileList].slice(0, 20);
  const parsed = [];
  for (const file of files) {
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') { parsed.push({ name: file.name, title: file.name, content: '', error: '這不是 .html 檔。請用 Ctrl + S 另存網頁後上傳 .html 檔。' }); continue; }
    if (file.size > MAX_HTML_BYTES) { parsed.push({ name: file.name, title: file.name, content: '', error: '檔案超過 5 MB。請改存「網頁，僅 HTML」再上傳。' }); continue; }
    parsed.push({ name: file.name, ...htmlToSource(decode(await file.arrayBuffer()), file.name) });
  }
  return parsed;
}
export async function readTextFiles(fileList) {
  const files = [...fileList].slice(0, 20);
  const items = [];
  for (const file of files) {
    if (file.size > 1024 * 1024) throw new Error(`「${file.name}」超過 1 MB。`);
    items.push({ name: file.name, title: file.name.replace(/\.[^.]+$/, '').slice(0, 100), content: (await file.text()).slice(0, 20000) });
  }
  return items;
}
