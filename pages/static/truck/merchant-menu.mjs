// 菜單管理: listing, today's sold-out switch, ordering, English menu and the item editor.
import { getState, esc, money, icon } from './client.mjs';
import { ui, btn, empty, taipeiToday, orderPath } from './merchant-ui.mjs';
import { openModal } from './merchant-modals.mjs';

const soldOutToday = item => item.soldOutOn === taipeiToday();
export const DEFAULT_MENU_IMAGE = '/static/truck/brand/truck-official.webp';

function thumb(item) {
  const src = item.image || '';
  return src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<span class="menu-thumb-fallback">${icon('leaf', 20)}</span>`;
}

export function menuView(state) {
  const menu = state.menu || [];
  const categories = ['全部', ...new Set(menu.map(item => item.category || '其他'))];
  if (!categories.includes(ui.menuCategory)) ui.menuCategory = '全部';
  const shown = menu.filter(item => ui.menuCategory === '全部' || (item.category || '其他') === ui.menuCategory);
  const listed = menu.filter(item => item.available !== false);
  const sold = listed.filter(soldOutToday);
  const english = menu.filter(item => item.nameEn).length;
  const rows = shown.map(item => {
    const index = menu.indexOf(item);
    const isSold = soldOutToday(item);
    const hidden = item.available === false;
    return `<article class="menu-row ${isSold ? 'is-sold' : ''} ${hidden ? 'is-hidden' : ''}">
      <div class="menu-thumb">${thumb(item)}</div>
      <div class="menu-info"><div class="menu-title"><strong>${esc(item.name)}</strong>${hidden ? '<span class="badge neutral">已下架</span>' : isSold ? '<span class="badge draft">今日售完</span>' : '<span class="badge approved">供應中</span>'}</div>
        <p class="menu-en">${item.nameEn ? `${icon('globe', 11)} ${esc(item.nameEn)}` : '<span class="muted">尚無英文名稱</span>'}</p>
        <p>${esc(item.category || '其他')} · ${esc(item.description || '尚未填寫介紹')}</p></div>
      <div class="menu-price">${money(item.price)}</div>
      <div class="menu-controls">
        <label class="switch labelled ${hidden ? 'disabled' : ''}"><input type="checkbox" data-action="menu-soldout" data-id="${esc(item.id)}" ${isSold ? 'checked' : ''} ${hidden ? 'disabled' : ''} aria-label="${esc(item.name)} 今日售完"><span></span><em>今日售完</em></label>
        <div class="menu-buttons">
          <button class="icon-button" data-action="menu-move" data-id="${esc(item.id)}" data-direction="up" aria-label="上移 ${esc(item.name)}" ${index === 0 ? 'disabled' : ''}>${icon('arrow-up', 15)}</button>
          <button class="icon-button" data-action="menu-move" data-id="${esc(item.id)}" data-direction="down" aria-label="下移 ${esc(item.name)}" ${index === menu.length - 1 ? 'disabled' : ''}>${icon('arrow-down', 15)}</button>
          ${btn(hidden ? '重新上架' : '下架', 'menu-listing', 'small', `data-id="${esc(item.id)}" data-available="${hidden ? 'true' : 'false'}"`)}
          ${btn(`${icon('pen', 12)} 編輯`, 'menu-edit', 'small', `data-id="${esc(item.id)}"`)}
        </div>
      </div></article>`;
  }).join('');
  return `<div class="stats">${[['供應中', listed.length - sold.length, '顧客可以點的餐點', 'check'], ['今日售完', sold.length, '明天自動恢復供應', 'clock'], ['已下架', menu.length - listed.length, '不會出現在點餐頁', 'ban'], ['英文菜單', `${english}/${menu.length}`, '切換英文時顯示', 'globe']].map(([label, value, note, i]) => `<div class="stat"><span class="stat-icon">${icon(i, 17)}</span><div class="stat-label">${label}</div><div class="stat-number">${value}</div><div class="stat-note">${note}</div></div>`).join('')}</div>
  <div class="notice sea">${icon('info', 16)}<span>「今日售完」只影響今天，隔天會自動恢復供應；「下架」會讓餐點從點餐頁消失，直到重新上架。英文菜單會在顧客切換到 English 時顯示，訂單一律以中文品名送到這裡。</span></div>
  <section class="panel"><div class="panel-head"><div class="list-filters" style="margin:0">${categories.map(name => `<button class="filter-btn ${ui.menuCategory === name ? 'active' : ''}" data-action="menu-category" data-category="${esc(name)}">${esc(name)} <small>${name === '全部' ? menu.length : menu.filter(item => (item.category || '其他') === name).length}</small></button>`).join('')}</div>
    <div class="actions">${sold.length ? btn(`${icon('refresh', 13)} 全部恢復供應`, 'menu-restock', 'small soft') : ''}<a class="btn small" href="${esc(orderPath())}" target="_blank" rel="noopener">${icon('eye', 13)} 預覽點餐頁</a></div></div>
    ${rows ? `<div class="menu-list">${rows}</div>` : empty(menu.length ? '這個分類沒有餐點' : '還沒有建立菜單', menu.length ? '切換其他分類，或新增餐點。' : '新增第一道餐點，顧客就能在手機上點餐。', 'menu-edit', '新增餐點')}</section>`;
}

export function menuModal(id) {
  const state = getState();
  const existing = state.menu.find(item => item.id === id);
  if (id && !existing) return;
  const m = existing || { name: '', price: 100, category: '', description: '', image: '', available: true, soldOutOn: null, nameEn: '', descriptionEn: '', categoryEn: '' };
  const categories = [...new Set(state.menu.map(item => item.category).filter(Boolean))];
  ui.menuImage = m.image || '';
  openModal(existing ? `編輯「${esc(m.name)}」` : '新增餐點', `<form id="menu-form" data-id="${esc(id || '')}">
    <div class="menu-editor"><div>
      <div class="field"><label for="menu-name">餐點名稱</label><input id="menu-name" required maxlength="100" value="${esc(m.name)}" placeholder="例如：海陸炒泡麵"></div>
      <div class="grid cols-2 form-grid"><div class="field"><label for="menu-price">價格（NT$）</label><input id="menu-price" type="number" min="0" max="100000" step="1" required value="${m.price}"></div>
        <div class="field"><label for="menu-category">分類</label><input id="menu-category" maxlength="40" list="menu-categories" placeholder="例如：主餐、飲料" value="${esc(m.category || '')}"><datalist id="menu-categories">${categories.map(name => `<option value="${esc(name)}">`).join('')}</datalist></div></div>
      <div class="field"><label for="menu-desc">餐點介紹</label><textarea id="menu-desc" maxlength="1000" style="min-height:80px" placeholder="主要食材、口味、份量">${esc(m.description)}</textarea></div>
      <details class="fold" ${m.nameEn ? 'open' : ''}><summary>${icon('globe', 14)} 英文菜單（顧客切換 English 時顯示）</summary>
        <div class="field"><label for="menu-name-en">英文名稱</label><input id="menu-name-en" maxlength="100" value="${esc(m.nameEn || '')}" placeholder="e.g. Stir-fried Noodles"></div>
        <div class="field"><label for="menu-category-en">英文分類</label><input id="menu-category-en" maxlength="40" value="${esc(m.categoryEn || '')}" placeholder="e.g. Mains"></div>
        <div class="field"><label for="menu-desc-en">英文介紹</label><textarea id="menu-desc-en" maxlength="1000" style="min-height:70px">${esc(m.descriptionEn || '')}</textarea><small>也可以在菜單管理頁按「AI 翻譯英文菜單」一次翻好全部。</small></div>
      </details>
    </div><div>
      <div class="menu-photo-preview" id="menu-photo-preview">${m.image ? `<img src="${esc(m.image)}" alt="餐點照片預覽">` : `<span>${icon('image', 26)}<br>尚未上傳照片</span>`}</div>
      <label class="upload-zone" style="margin-top:10px">${icon('upload', 18)}<strong>上傳餐點照片</strong><span class="fine">JPG / PNG / WebP，自動壓縮</span><input type="file" id="menu-photo" accept="image/jpeg,image/png,image/webp"></label>
      ${m.image ? btn('移除照片', 'menu-photo-clear', 'small', 'style="margin-top:8px"') : ''}
      <label class="inline-toggle"><input type="checkbox" id="menu-available" ${m.available !== false ? 'checked' : ''}>上架（顯示在點餐頁）</label>
      <label class="inline-toggle"><input type="checkbox" id="menu-soldout" ${m.soldOutOn === taipeiToday() ? 'checked' : ''}>今日售完</label>
    </div></div>
    <div class="modal-actions">${existing ? btn(`${icon('trash', 13)} 刪除餐點`, 'menu-delete', 'danger', `data-id="${esc(id)}"`) : ''}${btn('取消', 'modal-close')}<button class="btn primary" type="submit">儲存餐點</button></div></form>`, { wide: true });
}

export function menuPayload(form) {
  const previous = getState().menu.find(item => item.id === form.dataset.id);
  return {
    ...(previous ? { id: previous.id } : {}),
    name: document.getElementById('menu-name').value,
    price: Number(document.getElementById('menu-price').value),
    category: document.getElementById('menu-category').value.trim() || '其他',
    description: document.getElementById('menu-desc').value,
    image: ui.menuImage || '',
    nameEn: document.getElementById('menu-name-en').value.trim(),
    categoryEn: document.getElementById('menu-category-en').value.trim(),
    descriptionEn: document.getElementById('menu-desc-en').value.trim(),
    available: document.getElementById('menu-available').checked,
    soldOut: document.getElementById('menu-soldout').checked,
  };
}
