// 貼文工作區「快速開始」：內容主軸（來自品牌診斷）、趨勢（今日熱搜前三）、季節性、餐車營運四類，類別下再建議貼文主題。
import { esc, icon } from './client.mjs';
import { ui, btn, arrow, dateLabel, TOPICS, daysAgo } from './merchant-ui.mjs';

export const QUICK_TABS = [['pillar', 'dna', '內容主軸'], ['trend', 'trending', '趨勢'], ['season', 'calendar', '季節性'], ['ops', 'truck', '餐車營運']];
export const RISK = { low: ['低風險', 'approved'], medium: ['中風險', 'draft'], high: ['高風險・不建議', 'cancelled'] };
/** Shown on every trend post: what to check before riding a hot topic. */
export const RISK_TIPS = [
  '先點開來源新聞，確認事件內容與立場，避免誤解或傳錯資訊。',
  '災難、傷亡、犯罪、疾病、政治與社會爭議，不適合拿來行銷或開玩笑。',
  '不要使用新聞、藝人或其他品牌的照片、影片與商標，避免侵權與肖像權爭議。',
  '熱度通常只有 1–2 天，過了就別發，免得顯得過時。',
  '話題要和品牌調性一致，硬蹭容易引來負評留言。',
];
const sourceLinks = sources => (sources || []).map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${icon('external-link', 11)}${esc(source.title)}${source.source && !source.title.includes(source.source) ? `<small>· ${esc(source.source)}</small>` : ''}</a>`).join('');

export const offerText = offer => offer ? `${offer.label}${offer.code ? ` · ${offer.code}` : ''}` : '';
/** The warning a trend post carries in the editor (and before generating). */
export function trendWarning(trend, compact = false) {
  if (!trend) return '';
  const [label, style] = RISK[trend.riskLevel] || RISK.medium;
  return `<div class="trend-warning risk-${esc(trend.riskLevel || 'medium')}"><div class="trend-warning-head">${icon('shield', 15)}<strong>趨勢貼文風險提醒</strong><span class="badge ${style}">${label}</span></div>
    <p class="trend-warning-note">「${esc(trend.title)}」：${esc(trend.riskNote || '請先確認來源新聞再決定要不要發。')}</p>
    ${trend.hook ? `<p class="trend-warning-hook">${icon('bulb', 13)} 梗：「${esc(trend.hook.title)}」${trend.couponCode ? `　${icon('tag', 12)} 折扣碼 <code>${esc(trend.couponCode)}</code>（可在會員管理停用）` : ''}</p>` : ''}
    ${compact ? '' : `<ul>${RISK_TIPS.map(tip => `<li>${esc(tip)}</li>`).join('')}</ul>`}
    ${trend.sources?.length ? `<div class="trend-sources"><span>參考來源</span>${sourceLinks(trend.sources)}</div>` : ''}</div>`;
}
const buzzMeter = buzz => `<span class="buzz" title="討論度 ${buzz}/5">討論度 ${'<i class="on"></i>'.repeat(buzz)}${'<i></i>'.repeat(5 - buzz)}</span>`;

function pillarPane(s) {
  if (s.diagnosis.status !== 'ready' || !s.diagnosis.pillars?.length) {
    return `<div class="empty compact">${icon('dna', 26)}<h3>還沒有內容主軸</h3><p>建立 Brand DNA 後，這裡會依你的內容主軸建議貼文主題。</p><a class="btn soft small" href="/diagnosis">前往品牌診斷 ${arrow()}</a></div>`;
  }
  return `<div class="qs-groups">${s.diagnosis.pillars.map(pillar => `<div class="qs-group"><div class="qs-group-head"><strong>${esc(pillar.title)}</strong><small>${esc(pillar.detail)}</small></div><div class="qs-topics">${(pillar.topics || []).map(topic => `<button class="topic-chip" data-action="post-new" data-topic="${esc(topic)}" data-key="pillar"><strong>${esc(topic)}</strong></button>`).join('')}</div></div>`).join('')}</div>
    <p class="fine muted qs-note">主題來自<a class="text-link" href="/diagnosis">品牌診斷</a>的內容主軸；重新建立 Brand DNA 後會跟著更新。</p>`;
}
function trendPane(s) {
  const trends = s.trends;
  const items = trends?.items || [];
  const loading = ui.trendsLoading && !items.length;
  const refresh = btn(`${icon('refresh', 12)} 更新`, 'trends-refresh', 'small', ui.trendsLoading ? 'disabled' : '');
  const head = `<div class="notice">${icon('info', 16)}<span>這幾天大家都在聊的話題（不限領域），整理自 Google 新聞頭條與 Google 搜尋趨勢。挑討論度最高、又最好發揮的三個，每個附 2–3 個梗和搭配的時事優惠；點「用這個梗寫貼文」可以順便建立折扣碼。發文前請看風險提醒。</span></div>`;
  if (loading) return `${head}<p class="body-copy"><span class="loading-dot"></span> 正在整理這幾天的熱門話題…</p>`;
  const avoid = trends?.avoid || [];
  const avoidList = avoid.length ? `<details class="trend-avoid"><summary>${icon('shield', 13)} 也很熱、但不建議搭的話題（${avoid.length}）</summary>${avoid.map(item => `<div class="trend-avoid-row"><strong>${esc(item.title)}</strong>${item.summary ? `<p>${esc(item.summary)}</p>` : ''}<p class="trend-risk">${icon('shield', 13)}<span>${esc(item.riskNote)}</span></p><div class="trend-sources"><span>參考來源</span>${sourceLinks(item.sources)}</div></div>`).join('')}</details>` : '';
  if (!items.length) return `${head}<div class="empty compact">${icon('trending', 26)}<h3>${trends?.error ? '熱門話題暫時抓不到' : '還沒有今天的熱門話題'}</h3><p>${esc(trends?.error || '按「更新」整理這幾天的熱門話題。')}</p>${btn('整理熱門話題', 'trends-refresh', 'soft small')}</div>${avoidList}`;
  return `${head}<div class="trend-topics">${items.map((item, index) => {
    const [label, style] = RISK[item.riskLevel] || RISK.medium;
    const hooks = item.hooks || [];
    return `<article class="trend-topic risk-${esc(item.riskLevel || 'medium')}"><div class="trend-topic-info"><div class="trend-card-top"><span class="trend-rank">${index + 1}</span><div><strong>${esc(item.title)}</strong>${item.buzz ? buzzMeter(item.buzz) : item.traffic ? `<small>${esc(item.traffic)} 次搜尋</small>` : ''}</div><span class="badge ${style}">${label}</span></div>
      ${item.summary ? `<p class="trend-summary">${esc(item.summary)}</p>` : ''}<p class="trend-risk">${icon('shield', 13)}<span>${esc(item.riskNote)}</span></p>
      <div class="trend-sources"><span>參考來源</span>${sourceLinks(item.sources)}</div></div>
      <div class="trend-hooks">${hooks.length ? hooks.map(hook => `<div class="trend-hook"><strong>「${esc(hook.title)}」</strong><p>${esc(hook.angle)}</p>${hook.offer ? `<span class="offer-pill">${icon('tag', 11)} ${esc(offerText(hook.offer))}</span>` : ''}${btn(`用這個梗寫貼文 ${arrow()}`, 'post-new', 'small soft', `data-topic="${esc(hook.topic)}" data-key="trend" data-trend="${esc(item.id)}" data-hook="${esc(hook.id)}"`)}</div>`).join('') : btn(`用這個話題寫貼文 ${arrow()}`, 'post-new', 'small soft', `data-topic="${esc(item.topic)}" data-key="trend" data-trend="${esc(item.id)}"`)}</div></article>`;
  }).join('')}</div>${avoidList}
    <div class="qs-foot fine muted"><span>資料來源：Google 新聞頭條、Google 搜尋趨勢（台灣）· ${dateLabel(trends.generatedAt, { hour: '2-digit', minute: '2-digit' })} 更新${trends.engine === 'ai' ? ' · 話題、梗與風險由 AI 整理' : ' · 未啟用 AI，只列搜尋熱門字，梗與風險請自行判斷'}</span>${refresh}</div>`;
}
function seasonPane(s) {
  const items = s.trends?.seasonal || [];
  if (!items.length) return `<div class="empty compact">${icon('calendar', 26)}<h3>正在整理節慶與季節</h3><p>按「更新」整理接下來一個多月的節慶與季節話題。</p>${btn('整理季節話題', 'trends-refresh', 'soft small')}</div>`;
  return `<div class="season-cards">${items.map(item => `<article class="trend-item"><div><span class="badge ${item.kind === 'holiday' ? 'scheduled' : 'approved'}">${item.kind === 'holiday' ? '節慶' : '季節'}</span><strong>${esc(item.title)}</strong></div><p>${esc(item.why)}</p>${item.hashtags?.length ? `<p class="trend-tags">${item.hashtags.map(tag => `#${esc(tag)}`).join(' ')}</p>` : ''}${btn(`用這個寫貼文 ${arrow()}`, 'post-new', 'small soft', `data-topic="${esc(item.topic)}" data-key="season"`)}</article>`).join('')}</div>`;
}
function opsPane(s) {
  const used = key => s.posts.filter(post => post.topicKey === key && !post.suggested).map(post => post.publishedAt || post.scheduledAt || post.createdAt).sort().at(-1);
  const topics = TOPICS.map(topic => ({ ...topic, days: daysAgo(used(topic.key)) }));
  const stalest = [...topics].sort((a, b) => (b.days ?? 999) - (a.days ?? 999))[0];
  return `<p class="body-copy qs-lead">出車、菜單、會員這些日常營運主題，標示的天數是多久沒發過這一類。</p><div class="topic-grid">${topics.map(topic => `<button class="topic-chip ${topic.key === stalest.key ? 'recommended' : ''}" data-action="post-new" data-topic="${esc(topic.topic)}" data-key="${topic.key}"><strong>${esc(topic.label)}</strong><small>${topic.days === null ? '還沒發過' : topic.days === 0 ? '今天發過' : `${topic.days} 天沒發`}</small>${topic.key === stalest.key ? '<em>推薦</em>' : ''}</button>`).join('')}</div>`;
}

export function quickStart(s) {
  const fallback = s.diagnosis.status === 'ready' && s.diagnosis.pillars?.length ? 'pillar' : 'ops';
  const tab = QUICK_TABS.some(([key]) => key === ui.quickTab) ? ui.quickTab : fallback;
  const counts = { pillar: (s.diagnosis.pillars || []).reduce((sum, pillar) => sum + (pillar.topics?.length || 0), 0), trend: s.trends?.items?.length || 0, season: s.trends?.seasonal?.length || 0, ops: TOPICS.length };
  const panes = { pillar: pillarPane, trend: trendPane, season: seasonPane, ops: opsPane };
  return `<section class="panel quick-start"><div class="panel-head"><div><span class="eyebrow muted">QUICK START</span><h2 style="margin:6px 0 0">這次要發什麼？</h2></div><ul class="checklist inline">${[ui.ai?.enabled ? 'AI 依品牌五大面向撰寫' : '套用品牌語氣範本', '店家確認後才會發布'].map(text => `<li>${icon('check', 13)}${text}</li>`).join('')}</ul></div>
    <div class="tabs" role="tablist" aria-label="主題類別">${QUICK_TABS.map(([key, i, label]) => `<button type="button" role="tab" aria-selected="${key === tab}" class="tab ${key === tab ? 'active' : ''}" data-action="quick-tab" data-tab="${key}">${icon(i, 14)} ${label}${counts[key] ? ` <small>${counts[key]}</small>` : ''}</button>`).join('')}</div>
    <div class="qs-pane">${panes[tab](s)}</div></section>`;
}
