// 節慶 LOGO：依台北日期，在商家工作台與顧客點餐頁的 logo 加上節慶裝飾與動畫。
// 展示時可在網址加 ?festival=christmas（或下方任一 id）提前預覽，同一個分頁會記住；?festival=off 關閉，?festival=auto 回到依日期。
// 系統設定「減少動態效果」時只顯示靜態裝飾。

/** 農曆節日的國曆日期（春節＝正月初一）。年份用完前請補上下一年。 */
const LUNAR = {
  2026: { spring: '02-17', lantern: '03-03', dragon: '06-19', qixi: '08-19', moon: '09-25' },
  2027: { spring: '02-06', lantern: '02-20', dragon: '06-09', qixi: '08-08', moon: '09-15' },
  2028: { spring: '01-26', lantern: '02-09', dragon: '05-28', qixi: '08-26', moon: '10-03' },
  2029: { spring: '02-13', lantern: '02-27', dragon: '06-16', qixi: '08-16', moon: '09-22' },
  2030: { spring: '02-03', lantern: '02-17', dragon: '06-05', qixi: '08-05', moon: '09-12' },
};
const DAY = 86400000;
const iso = time => new Date(time).toISOString().slice(0, 10);
const shift = (date, days) => iso(Date.parse(`${date}T00:00:00Z`) + days * DAY);
/** Second Sunday of May (台灣母親節). */
function mothersDay(year) {
  const first = new Date(Date.UTC(year, 4, 1)).getUTCDay();
  return `${year}-05-${String(1 + ((7 - first) % 7) + 7).padStart(2, '0')}`;
}

/** [id, 名稱, 祝福語, 開始, 結束]（含頭尾，依年份計算；清單前面的節慶優先）。 */
function windows(year) {
  const lunar = LUNAR[year] || {};
  const at = key => (lunar[key] ? `${year}-${lunar[key]}` : null);
  const rows = [
    ['christmas', '聖誕節', '聖誕快樂', `${year}-12-18`, `${year}-12-26`],
    ['newyear', '跨年', '新年快樂', `${year}-12-30`, `${year + 1}-01-02`],
    ['newyear', '跨年', '新年快樂', `${year - 1}-12-30`, `${year}-01-02`],
    ['lunar', '農曆新年', '新春快樂', at('spring') && shift(at('spring'), -6), at('spring') && shift(at('spring'), 5)],
    ['lantern', '元宵節', '元宵節快樂', at('lantern') && shift(at('lantern'), -2), at('lantern')],
    ['valentine', '情人節', '情人節快樂', `${year}-02-10`, `${year}-02-14`],
    ['mother', '母親節', '母親節快樂', shift(mothersDay(year), -6), mothersDay(year)],
    ['dragonboat', '端午節', '端午節安康', at('dragon') && shift(at('dragon'), -4), at('dragon')],
    ['qixi', '七夕', '七夕快樂', at('qixi') && shift(at('qixi'), -3), at('qixi')],
    ['midautumn', '中秋節', '中秋節快樂', at('moon') && shift(at('moon'), -6), at('moon')],
    ['halloween', '萬聖節', 'Happy Halloween', `${year}-10-24`, `${year}-10-31`],
  ];
  return rows.filter(([, , , start, end]) => start && end);
}
export const FESTIVAL_IDS = ['christmas', 'newyear', 'lunar', 'lantern', 'valentine', 'mother', 'dragonboat', 'qixi', 'midautumn', 'halloween'];
const NAMES = { christmas: ['聖誕節', '聖誕快樂'], newyear: ['跨年', '新年快樂'], lunar: ['農曆新年', '新春快樂'], lantern: ['元宵節', '元宵節快樂'], valentine: ['情人節', '情人節快樂'], mother: ['母親節', '母親節快樂'], dragonboat: ['端午節', '端午節安康'], qixi: ['七夕', '七夕快樂'], midautumn: ['中秋節', '中秋節快樂'], halloween: ['萬聖節', 'Happy Halloween'] };

const PREVIEW_KEY = 'branddna.festival';
/** Preview override from ?festival=… (kept for this tab so moving between pages keeps it). */
function preview() {
  let value = null;
  try {
    const param = new URLSearchParams(location.search).get('festival');
    if (param === 'auto') sessionStorage.removeItem(PREVIEW_KEY);
    else if (param && (param === 'off' || FESTIVAL_IDS.includes(param))) sessionStorage.setItem(PREVIEW_KEY, param);
    value = sessionStorage.getItem(PREVIEW_KEY);
  } catch { /* private mode: date only */ }
  return value;
}
/** The festival shown today (Taipei date), or null. `now` is injectable for tests. */
export function currentFestival(now = Date.now(), usePreview = true) {
  const forced = usePreview ? preview() : null;
  if (forced === 'off') return null;
  if (forced && NAMES[forced]) return { id: forced, name: NAMES[forced][0], greeting: NAMES[forced][1] };
  const today = iso(now + 8 * 3600000);
  const year = Number(today.slice(0, 4));
  const hit = windows(year).find(([, , , start, end]) => today >= start && today <= end);
  return hit ? { id: hit[0], name: hit[1], greeting: hit[2] } : null;
}

// --- Decorations (inline SVG, sized and placed in % of the logo so one set fits every logo) ---
const burst = color => `<svg viewBox="-10 -10 20 20"><g stroke="${color}" stroke-width="1.5" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return `<line x1="${(Math.cos(a) * 3).toFixed(2)}" y1="${(Math.sin(a) * 3).toFixed(2)}" x2="${(Math.cos(a) * 8.5).toFixed(2)}" y2="${(Math.sin(a) * 8.5).toFixed(2)}"/>`; }).join('')}</g><circle r="1.4" fill="${color}"/></svg>`;
const heart = color => `<svg viewBox="0 0 20 18"><path d="M10 17C-5 7.5 2.5-3 10 4c7.5-7 15 3.5 0 13z" fill="${color}"/></svg>`;
const star = color => `<svg viewBox="-10 -10 20 20"><path d="M0-9C1-2 2-1 9 0 2 1 1 2 0 9-1 2-2 1-9 0-2-1-1-2 0-9z" fill="${color}"/></svg>`;
const flakes = count => `<span class="fx-snow">${Array.from({ length: count }, (_, i) => `<i style="left:${(i * 97) % 100}%;animation-delay:${(-(i * 0.53) % 4).toFixed(2)}s;animation-duration:${(3.4 + (i % 4) * 0.55).toFixed(2)}s;font-size:${(0.24 + (i % 3) * 0.07).toFixed(2)}em">❄</i>`).join('')}</span>`;
const DECO = {
  christmas: `${flakes(9)}<svg class="fx-snowcap" viewBox="0 0 40 11"><path d="M1.5 9C1 4 5 2.6 8.4 3.6 10.4.4 15.6.2 18 3.4c2.6-2.6 7.6-2.4 9.6.8 3-2 8.6-.8 9.8 3.6.5 2-1 3.2-3 3.2H4.5C2.6 11 1.6 10.2 1.5 9z" fill="#fff" stroke="#cfdfe8" stroke-width=".7"/><circle cx="13" cy="8.2" r="1" fill="#e6eff4"/><circle cx="26" cy="8.6" r="1.1" fill="#e6eff4"/></svg>
    <svg class="fx-hat" viewBox="0 0 42 34"><path d="M5 26C8 14 17 5 30 4c4 .4 6.5 3 7.5 7-3-2-6-2.4-7.6-.6C27 15 28 21 30 26z" fill="#d8453b"/><path d="M30 4c4 .4 6.5 3 7.5 7" stroke="#b5352e" stroke-width="1" fill="none"/><rect x="2" y="23.5" width="31" height="8" rx="4" fill="#fff" stroke="#dfe7ea" stroke-width=".8"/><circle cx="37.8" cy="11.6" r="4" fill="#fff" stroke="#dfe7ea" stroke-width=".8"/></svg>`,
  newyear: `<span class="fx-burst b1">${burst('#e3a93c')}</span><span class="fx-burst b2">${burst('#e2725b')}</span><span class="fx-burst b3">${burst('#3f9a8f')}</span>`,
  lunar: `<svg class="fx-lantern" viewBox="0 0 20 36"><line x1="10" y1="0" x2="10" y2="6" stroke="#b8862f" stroke-width="1"/><rect x="5.5" y="5" width="9" height="3" rx="1.2" fill="#e2b14a"/><ellipse cx="10" cy="16.5" rx="9" ry="9.5" fill="#d93b30"/><path d="M10 7.5v18M4.5 10c2.4 4 2.4 9 0 13M15.5 10c-2.4 4-2.4 9 0 13" stroke="#f3c055" stroke-width=".9" fill="none" opacity=".85"/><rect x="5.5" y="25" width="9" height="3" rx="1.2" fill="#e2b14a"/><path d="M8 28v7M10 28v8M12 28v7" stroke="#e2a83a" stroke-width="1"/></svg><span class="fx-sparkle s1">${star('#e9b949')}</span><span class="fx-sparkle s2">${star('#e9b949')}</span>`,
  lantern: [0, 1, 2].map(i => `<svg class="fx-sky k${i}" viewBox="0 0 14 18"><path d="M3 1h8l3 14H0z" fill="#f2a23a"/><ellipse cx="7" cy="13.5" rx="4.6" ry="2.2" fill="#ffd978" opacity=".9"/><path d="M3 1h8" stroke="#d9822b" stroke-width="1.4"/></svg>`).join(''),
  valentine: [0, 1, 2, 3].map(i => `<span class="fx-float h${i}">${heart(i % 2 ? '#f08aa0' : '#e04f6a')}</span>`).join(''),
  mother: `<svg class="fx-flower" viewBox="0 0 26 40"><path d="M13 39C13 30 12 24 13 17" stroke="#5f9a52" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M13 30c-5-1-8-4-8-8 4 0 7 3 8 8zM13 26c4-1 7-4 7-7-4 0-6 3-7 7z" fill="#76b064"/><g fill="#e8658a"><circle cx="13" cy="10" r="7"/><circle cx="7.5" cy="12" r="4.5"/><circle cx="18.5" cy="12" r="4.5"/><circle cx="10" cy="5.5" r="4.2"/><circle cx="16" cy="5.5" r="4.2"/></g><path d="M8 9c2 2 8 2 10 0M9 13c2 1.5 6 1.5 8 0" stroke="#c84470" stroke-width="1" fill="none"/></svg><span class="fx-float h0">${heart('#f08aa0')}</span><span class="fx-float h2">${heart('#e8658a')}</span>`,
  dragonboat: `<svg class="fx-zongzi" viewBox="0 0 30 28"><path d="M15 2 28 25H2z" fill="#4f8f4a" stroke="#3c7438" stroke-width="1.2" stroke-linejoin="round"/><path d="M15 2 10 25M15 2l6 23" stroke="#78b56d" stroke-width="1" fill="none"/><path d="M5.5 18.5h19" stroke="#c99a5a" stroke-width="2.2" stroke-linecap="round"/><path d="M7 14c3 1 13 1 16 0" stroke="#c99a5a" stroke-width="1.2" fill="none"/></svg><svg class="fx-wave" viewBox="0 0 40 8"><path d="M0 5c4-4 6-4 10 0s6 4 10 0 6-4 10 0 6 4 10 0" stroke="#5aa3b8" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  qixi: `<svg class="fx-bridge" viewBox="0 0 60 20"><path d="M3 18C15 2 45 2 57 18" stroke="#b9a7e0" stroke-width="1.6" stroke-dasharray="1 3.2" stroke-linecap="round" fill="none"/></svg><span class="fx-sparkle s1">${star('#a88fe0')}</span><span class="fx-sparkle s2">${star('#e9b949')}</span><span class="fx-heart">${heart('#e45f86')}</span>`,
  midautumn: `<svg class="fx-moon" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#f7d774"/><circle cx="10" cy="11" r="2.4" fill="#efc65b"/><circle cx="19" cy="19" r="3" fill="#efc65b"/><circle cx="20" cy="9" r="1.4" fill="#efc65b"/></svg><span class="fx-sparkle s1">${star('#e9b949')}</span><span class="fx-sparkle s2">${star('#9fb7d6')}</span>`,
  halloween: `<svg class="fx-pumpkin" viewBox="0 0 30 26"><path d="M15 5c1-3 3-4 5-4" stroke="#5f7d3a" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="9" cy="15" rx="8" ry="9.5" fill="#e98a2c"/><ellipse cx="21" cy="15" rx="8" ry="9.5" fill="#e98a2c"/><ellipse cx="15" cy="15" rx="7" ry="10" fill="#f39b38"/><path d="M8 12l3 3H6zM22 12l2 3h-5zM9 19c3 3 9 3 12 0l-2 1-2-1-2 1-2-1-2 1z" fill="#5a2f12"/></svg><svg class="fx-bat" viewBox="0 0 40 18"><path class="fx-wing" d="M20 8C17 3 10 1 2 4c4 1 5 4 4 7 3-2 6-1 7 2 2-2 5-3 7-5zM20 8c3-5 10-7 18-4-4 1-5 4-4 7-3-2-6-1-7 2-2-2-5-3-7-5z" fill="#3b2f4a"/><circle cx="20" cy="9" r="2.6" fill="#3b2f4a"/></svg>`,
};

const CSS = `.festive{position:relative;display:inline-flex;align-items:center;justify-content:center;isolation:isolate;line-height:0;font-size:28px;flex-shrink:0}
.festive-deco{position:absolute;inset:0;pointer-events:none}.festive-deco>*{position:absolute;display:block}.festive-deco svg{overflow:visible}
.fx-snow{inset:-55% -75% -25%;overflow:hidden}.fx-snow i{position:absolute;top:-12%;font-style:normal;line-height:1;color:#8fb3c9;opacity:0;animation:fx-fall 4s linear infinite}
@keyframes fx-fall{0%{top:-12%;transform:translateX(0) rotate(0);opacity:0}15%{opacity:.95}80%{opacity:.8}100%{top:100%;transform:translateX(5px) rotate(160deg);opacity:0}}
.fx-snowcap{top:-4%;left:-6%;width:112%;filter:drop-shadow(0 1px 1px #2a4a5a40)}
.fx-hat{top:-50%;right:-34%;width:72%;transform:rotate(16deg);transform-origin:20% 90%;animation:fx-tip 3.6s ease-in-out infinite;filter:drop-shadow(0 1px 1px #0002)}
@keyframes fx-tip{0%,100%{transform:rotate(16deg)}50%{transform:rotate(22deg)}}
.fx-burst{width:58%;opacity:0;animation:fx-pop 2.4s ease-out infinite}.fx-burst.b1{top:-62%;left:-38%}.fx-burst.b2{top:-70%;right:-48%;animation-delay:.8s}.fx-burst.b3{top:-10%;right:-80%;width:42%;animation-delay:1.6s}
@keyframes fx-pop{0%{transform:scale(.2);opacity:0}15%{opacity:1}60%{transform:scale(1);opacity:.9}100%{transform:scale(1.15);opacity:0}}
.fx-lantern{top:-30%;left:-44%;width:40%;transform-origin:50% 0;animation:fx-swing 2.8s ease-in-out infinite;filter:drop-shadow(0 0 3px #f2a23a88)}
@keyframes fx-swing{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}
.fx-sparkle{width:26%;animation:fx-twinkle 2.2s ease-in-out infinite}.fx-sparkle.s1{top:-38%;left:-30%}.fx-sparkle.s2{bottom:-14%;left:-38%;width:20%;animation-delay:1.1s}
@keyframes fx-twinkle{0%,100%{transform:scale(.5);opacity:.3}50%{transform:scale(1);opacity:1}}
.fx-sky{bottom:0;width:30%;opacity:0;animation:fx-rise 5s ease-in infinite;filter:drop-shadow(0 0 4px #ffb84d)}.fx-sky.k0{left:-35%}.fx-sky.k1{left:-70%;animation-delay:1.7s;width:24%}.fx-sky.k2{left:30%;animation-delay:3.3s;width:20%}
@keyframes fx-rise{0%{transform:translateY(40%);opacity:0}15%{opacity:1}100%{transform:translateY(-330%) translateX(6%);opacity:0}}
.fx-float{bottom:-5%;width:30%;opacity:0;animation:fx-up 3.6s ease-in infinite}.fx-float.h0{left:-40%}.fx-float.h1{right:-15%;animation-delay:.9s;width:22%}.fx-float.h2{left:-38%;animation-delay:1.8s;width:24%}.fx-float.h3{left:20%;animation-delay:2.7s;width:20%}
@keyframes fx-up{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:1}100%{transform:translateY(-260%) translateX(-12%) scale(1);opacity:0}}
.fx-flower{bottom:-30%;left:-50%;width:46%;transform-origin:50% 100%;animation:fx-sway 3s ease-in-out infinite}
@keyframes fx-sway{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
.fx-zongzi{bottom:-24%;left:-56%;width:52%;animation:fx-bob 2.4s ease-in-out infinite}.fx-wave{bottom:-34%;left:-66%;width:72%;animation:fx-drift 2.4s ease-in-out infinite}
@keyframes fx-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-14%) rotate(4deg)}}@keyframes fx-drift{0%,100%{transform:translateX(0)}50%{transform:translateX(8%)}}
.fx-bridge{top:-46%;left:-30%;width:160%;opacity:.9}.fx-heart{top:-58%;left:38%;width:26%;animation:fx-beat 1.6s ease-in-out infinite}
@keyframes fx-beat{0%,100%{transform:scale(.85)}30%{transform:scale(1.1)}}
.fx-moon{top:-42%;left:-52%;width:66%;z-index:-1;animation:fx-glow 4s ease-in-out infinite}
@keyframes fx-glow{0%,100%{filter:drop-shadow(0 0 2px #f7d77488)}50%{filter:drop-shadow(0 0 7px #f7d774)}}
.fx-pumpkin{bottom:-26%;left:-54%;width:50%;animation:fx-bob 2.6s ease-in-out infinite}
.fx-bat{top:-40%;left:-50%;width:56%;animation:fx-fly 5s ease-in-out infinite}.fx-wing{transform-origin:50% 50%;animation:fx-flap .35s ease-in-out infinite alternate}
@keyframes fx-fly{0%,100%{transform:translate(0,0)}25%{transform:translate(40%,-25%)}50%{transform:translate(110%,5%)}75%{transform:translate(45%,20%)}}@keyframes fx-flap{from{transform:scaleY(1)}to{transform:scaleY(.45)}}
@media (prefers-reduced-motion:reduce){.festive-deco *{animation:none!important}.fx-snow i{opacity:.8;top:30%}.fx-burst,.fx-sky,.fx-float{opacity:1}}`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById('festive-style')) return;
  const style = document.createElement('style');
  style.id = 'festive-style';
  style.textContent = CSS;
  document.head.append(style);
}
/** Wraps a logo mark with today's festival decoration; returns the mark unchanged on ordinary days. */
export function festiveMark(markHtml, festival = currentFestival()) {
  if (!festival || !DECO[festival.id]) return markHtml;
  ensureStyle();
  return `<span class="festive festive-${festival.id}" title="${festival.greeting}" data-festival="${festival.id}">${markHtml}<span class="festive-deco" aria-hidden="true">${DECO[festival.id]}</span></span>`;
}
