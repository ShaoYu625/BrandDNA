// 品牌診斷的語氣庫／客群庫說明（滑過標籤看定義與範例）與「與一般餐車比較」表。
import { esc, icon } from './client.mjs';
import { toneByLabel, audienceByLabel } from './brand-libraries.mjs';

export const VERDICT = { advantage: ['優於一般', 'approved'], similar: ['相近', 'neutral'], weaker: ['待加強', 'draft'], unknown: ['資料不足', 'neutral muted-badge'] };
const BASIS = { data: '系統資料', ai: 'AI 判斷', rules: '關鍵字估算' };

/**
 * A tone or audience tag. Library entries show their definition and example on hover, keyboard focus or tap
 * (the tag is focusable, so a tap on a phone opens it too). Older free-text entries render as a plain tag.
 */
export function libTag(label, kind) {
  const entry = kind === 'tone' ? toneByLabel(label) : audienceByLabel(label);
  if (!entry) return `<span class="tag">${esc(label)}</span>`;
  const id = `tip-${kind}-${entry.id}`;
  return `<span class="tag lib-tag" tabindex="0" aria-describedby="${id}">${esc(entry.label)}${icon('info', 10)}<span class="lib-tip" role="tooltip" id="${id}"><strong>${esc(entry.label)}</strong><span>${esc(entry.definition)}</span><em>${kind === 'tone' ? '範例' : '情境'}：${esc(entry.example)}</em></span></span>`;
}

export function comparisonPanel(d) {
  const rows = d.comparison || [];
  if (!rows.length) return `<section class="panel section-space" id="comparison"><div class="panel-head"><h2>${icon('star', 16)} 與一般餐車比較</h2></div><p class="body-copy">這份 Brand DNA 是舊版建立的，還沒有跟一般餐車比較。按右上角「重新建立 Brand DNA」就會產生。</p></section>`;
  const order = { advantage: 0, weaker: 1, similar: 2, unknown: 3 };
  const sorted = [...rows].sort((a, b) => order[a.verdict] - order[b.verdict]);
  const wins = rows.filter(row => row.verdict === 'advantage').length;
  return `<section class="panel section-space" id="comparison"><div class="panel-head"><div><span class="eyebrow muted">DIFFERENTIATION</span><h2>${icon('star', 16)} 與一般餐車比較 <span class="badge approved">${wins} 項優於一般</span></h2></div><span class="muted fine">「差異化優勢」就是下表中優於一般的項目</span></div>
    <div class="wide-table"><table class="source-table compare-table"><thead><tr><th>項目</th><th>一般餐車<small>參考基準</small></th><th>本店</th><th>比較</th></tr></thead><tbody>${sorted.map(row => {
      const [label, style] = VERDICT[row.verdict] || VERDICT.unknown;
      return `<tr class="verdict-${esc(row.verdict)}"><td><strong>${esc(row.label)}</strong></td><td class="muted">${esc(row.typical)}</td><td>${esc(row.store)}</td><td><span class="badge ${style}">${label}</span><small class="basis">${BASIS[row.basis] || ''}</small></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="fine muted" style="margin-top:12px">${icon('info', 12)} 「一般餐車」是團隊整理的經驗值，不是統計調查，僅供參考。點餐、會員、發文、出攤與外語由系統依實際資料判斷，其餘${d.engine === 'ai' ? '由 AI 讀資料中心判斷' : '用關鍵字粗估（啟用 AI 後會更準）'}。</p></section>`;
}
