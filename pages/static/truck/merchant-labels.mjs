// 行事曆顏色標籤：預設「出攤（綠）」「貼文（橘）」，排程或新增出攤時可以按「自訂」建立新的類型＋顏色，系統會記住。
import { getState, esc, icon } from './client.mjs';

export const BUILTIN_LABELS = [{ id: 'stall', name: '出攤', color: 'green' }, { id: 'post', name: '貼文', color: 'orange' }];
/** Preset colours only (mirrors the server's LABEL_COLORS), so every label stays readable on the calendar. */
export const LABEL_COLORS = [['green', '綠'], ['orange', '橘'], ['blue', '藍'], ['purple', '紫'], ['pink', '粉紅'], ['red', '紅'], ['teal', '青'], ['yellow', '黃']];
export const allLabels = (state = getState()) => [...BUILTIN_LABELS, ...(state?.settings?.calendarLabels || [])];
export const labelFor = (state, id, fallback) => allLabels(state).find(label => label.id === id) || BUILTIN_LABELS.find(label => label.id === fallback);
/** Pre-selected label: the event's own, else what this kind of post used last time, else the default. */
export function defaultLabel(state, kind, item) {
  if (item?.label && allLabels(state).some(label => label.id === item.label)) return item.label;
  if (kind === 'post' && item?.topicKey) {
    const remembered = state.settings?.labelRules?.[item.topicKey];
    if (remembered && allLabels(state).some(label => label.id === remembered)) return remembered;
  }
  return kind;
}
export const swatches = (selected = 'blue', name = 'label-color') => `<div class="swatches" role="radiogroup" aria-label="顏色">${LABEL_COLORS.map(([color, label]) => `<label class="swatch lbl-${color}" title="${label}"><input type="radio" name="${name}" value="${color}" ${color === selected ? 'checked' : ''} aria-label="${label}"><span></span></label>`).join('')}</div>`;

/** The label row inside the schedule / stall dialogs, with the 「自訂」 button that opens a small editor in place. */
export function labelField(selected, { creating = false } = {}) {
  const labels = allLabels();
  return `<div class="field label-field" id="label-field"><label id="label-field-title">顏色標籤</label>
    <div class="label-picker" role="radiogroup" aria-labelledby="label-field-title">${labels.map(label => `<label class="label-chip lbl-${esc(label.color)}"><input type="radio" name="event-label" value="${esc(label.id)}" ${label.id === selected ? 'checked' : ''}><span><i></i>${esc(label.name)}</span></label>`).join('')}
      ${creating ? '' : `<button type="button" class="label-chip add" data-action="label-custom">${icon('plus', 11)} 自訂</button>`}</div>
    ${creating ? `<div class="label-custom"><input id="label-name" maxlength="8" placeholder="類型名稱，例如：節慶活動" aria-label="新標籤名稱">${swatches()}<div class="actions"><button type="button" class="btn small primary" data-action="label-create">新增並選用</button><button type="button" class="btn small" data-action="label-custom-cancel">取消</button></div></div>` : ''}
    <small>自訂的類型和顏色會記住，之後排程都能直接選；同一類貼文下次會自動帶入上次的標籤。</small></div>`;
}
export const chosenLabel = form => form.querySelector('input[name="event-label"]:checked')?.value || '';
