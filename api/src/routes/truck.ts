import { Env, HttpError } from "../schema";
import { isPublicationJpeg } from "../meta-content";
// Shared with the customer page's district picker (single source of truth).
import { TW_DISTRICTS } from "../../../pages/static/truck/tw-districts.mjs";
// Tone / audience libraries and the 一般餐車 baseline, shared with the merchant page's hover help.
import { TONES, AUDIENCES, BASELINE } from "../../../pages/static/truck/brand-libraries.mjs";

export interface TruckSource { id: string; title: string; type: string; content: string; status: "ready" | "analyzed"; createdAt: string; updatedAt?: string; mode?: "meta" }
export interface Archetype { id: string; label: string; score: number; description: string }
/** A content pillar with ready-to-use post topics (quick start in 貼文工作區 starts from these). */
export interface Pillar { title: string; detail: string; topics: string[] }
/** A core audience from the audience library, with this truck's buying situation. */
export interface AudienceEntry { label: string; situation: string }
export type Verdict = "advantage" | "similar" | "weaker" | "unknown";
/** One line of 「與一般餐車比較」: the baseline (團隊整理的參考基準) next to what this truck does. */
export interface ComparisonRow { id: string; label: string; typical: string; store: string; verdict: Verdict; basis: "data" | "ai" | "rules" }
export interface Diagnosis {
  /** `tone` holds tone-library labels; `audience` is the display text of `audiences`; `differentiation` lists the comparison's advantages. */
  status: "ready" | "empty"; generatedAt: string; positioning: string; tone: string[]; toneNote: string; audience: string[]; audiences: AudienceEntry[];
  differentiation: string[]; comparison: ComparisonRow[]; pillars: Pillar[]; summary: string; feedbackAt: string | null; engine: "ai" | "rules";
}
export interface Metrics {
  reach: number | null; likes: number | null; comments: number | null; saves: number | null; clicks: number | null;
  views?: number | null; shares?: number | null; fetchedAt?: string; period?: "lifetime"; reason?: string; manual?: boolean;
}
export interface Post {
  id: string; platform: "instagram" | "facebook"; title: string; topic: string; caption: string; image: string; cardTitle: string;
  status: "draft" | "approved" | "scheduled" | "published"; createdAt: string; scheduledAt: string | null;
  publishedAt: string | null; metrics: Metrics | null; mode: "demo" | "meta";
  topicKey?: string; suggested?: boolean; engine?: "ai" | "rules";
  /** Written from today's hot topic: the owner sees the sources and the risk warning while editing. */
  trend?: PostTrend;
  /** Calendar colour label id (built-in "post" when absent). */
  label?: string;
  meta?: {
    accountId: string; accountName: string; status: "approved" | "queued" | "publishing" | "published" | "failed" | "unknown" | "cancelled";
    image?: string; thumbnail?: string; version?: string; attempt?: string; remoteId?: string;
    kind?: "photo" | "text" | "link"; link?: string; permalink?: string | null; error?: string; imported?: boolean;
    containerId?: string; attemptedAt?: string;
    insightsCheckedAt?: string; insightsError?: string | null;
  };
}
export interface Stall { id: string; title: string; date: string; start: string; end: string; location: string; notes: string; label?: string }
/** A colour label on the calendar. Built-in: 出攤 (green) and 貼文 (orange); the merchant can add their own. */
export interface CalendarLabel { id: string; name: string; color: string }
export const LABEL_COLORS = ["green", "orange", "blue", "purple", "pink", "red", "teal", "yellow"];
export const BUILTIN_LABELS: CalendarLabel[] = [{ id: "stall", name: "出攤", color: "green" }, { id: "post", name: "貼文", color: "orange" }];
const MAX_CUSTOM_LABELS = 12;
export interface TrendSource { title: string; url: string; source: string }
/** A 時事 offer that goes with a joke hook (`value`: NT$ off, or percent off for "percent"). */
export interface TrendOffer { label: string; kind: "amount" | "percent"; value: number; code: string }
/** One joke angle for a hot topic, e.g. 「買輝達賠錢，只好來吃炒麵療傷」, with its matching offer. */
export interface TrendHook { id: string; title: string; angle: string; topic: string; offer: TrendOffer | null }
export interface PostTrend {
  title: string; angle: string; riskLevel: "low" | "medium" | "high"; riskNote: string; sources: TrendSource[];
  summary?: string; hook?: { title: string; angle: string; offer: TrendOffer | null }; couponCode?: string;
}
export interface MenuItem {
  id: string; name: string; price: number; category: string; description: string; image: string;
  /** Listed on the customer menu. `soldOutOn` marks the Taipei date the item sold out; it is available again the next day. */
  available: boolean; soldOutOn: string | null; nameEn: string; descriptionEn: string; categoryEn: string;
}
export interface Demographics {
  gender: string; birthYear: number | null; city: string; district: string; occupation: string; income: string;
  household: string; diet: string[]; channel: string;
}
interface Customer { name: string; phone: string; lineBound: boolean }
interface OrderItem { menuId: string; name: string; price: number; quantity: number }
type OrderStatus = "new" | "accepted" | "preparing" | "ready" | "completed" | "cancelled";
export interface OrderDiscount { code: string; label: string; amount: number; couponId: string }
export interface Order {
  id: string; number: string; customer: Customer; items: OrderItem[]; subtotal: number; discount: OrderDiscount | null; total: number;
  status: OrderStatus; createdAt: string; note: string; memberId: string | null;
  /** Last status change (elapsed time on the merchant board). */
  updatedAt?: string; cancelReason?: string;
}
/** One-time sign-in code a merchant hands to a member in person (new phone, cleared browser). */
export interface MemberLoginCode { code: string; expiresAt: string; attempts: number }
export interface Member extends Customer {
  id: string; createdAt: string; demographics: Demographics | null; profileAt: string | null; consentAt: string | null; optIn: boolean;
  loginCode?: MemberLoginCode | null;
}
export interface Coupon {
  id: string; code: string; label: string; kind: "amount" | "percent" | "bogo"; value: number; itemId: string | null; minSpend: number;
  memberIds: string[] | null; maxUses: number | null; uses: number; usedBy: string[]; expiresAt: string | null;
  source: "campaign" | "profile" | "manual"; campaignId: string | null; active: boolean; createdAt: string;
}
export interface Campaign {
  id: string; segment: string; segmentLabel: string; kind: "activity" | "coupon" | "profile"; title: string; message: string;
  couponId: string | null; couponCode: string | null; recipients: string[]; sentAt: string;
}
export interface Trend {
  id: string; title: string; why: string; topic: string; hashtags: string[]; kind: "holiday" | "season" | "insight" | "ai" | "hot"; date: string | null;
  /** Hot topics only: what happened, how much it is talked about (1–5), news links, risk, and joke hooks with offers. */
  traffic?: string; sources?: TrendSource[]; riskLevel?: "low" | "medium" | "high"; riskNote?: string;
  summary?: string; buzz?: number; hooks?: TrendHook[];
}
/** `items`: the three hottest topics a truck can play with; `avoid`: hot but high-risk topics (shown, not suggested); `seasonal`: holidays and the season. */
export interface TrendState { generatedAt: string; date: string; items: Trend[]; avoid: Trend[]; seasonal: Trend[]; engine: "ai" | "rules"; error?: string }
export interface AssistantState { lastCheckAt: string | null; suggestionPostId: string | null; topicKey: string | null; idleDays: number; reason: string }
export interface RfmSettings { loyalOrders: number; activeDays: number; churnDays: number; bigOrder: number }
/** Whether the customer page accepts new orders right now. */
export interface OrderingSettings { paused: boolean; message: string }
/** `labelRules`: post topic category → the label last chosen for it (pre-selected the next time). */
export interface TruckSettings { profileReward: number; profileRewardDays: number; rfm: RfmSettings; ordering: OrderingSettings; calendarLabels: CalendarLabel[]; labelRules: Record<string, string> }
export interface TruckBrand {
  name: string; shortName: string; category: string; description: string; location: string; tagline: string; since: string;
  nameEn: string; descriptionEn: string; coverImage: string; instagram: string; website: string;
}
interface Activity { id: string; text: string; date: string; type: string }
export interface TruckState {
  brand: TruckBrand; sources: TruckSource[]; archetypes: Archetype[]; diagnosis: Diagnosis; posts: Post[]; stalls: Stall[];
  menu: MenuItem[]; orders: Order[]; members: Member[]; coupons: Coupon[]; campaigns: Campaign[]; activity: Activity[];
  trends: TrendState | null; assistant: AssistantState; settings: TruckSettings; workspace: { version: number; createdAt: string };
  revision: number;
}
type Payload = Record<string, unknown>;
export type ActionResult = { state: TruckState; result: Record<string, unknown>; noop?: boolean };
/** Results prepared outside the pure reducer (LLM output, fetched pages, OCR text). Never taken from the client payload. */
export interface ActionExtras { ai?: unknown; prepared?: unknown; aiError?: string }
type TruckEnv = Pick<Env, "DB"> & Partial<Pick<Env, "BUCKET">>;
const ORDER_STEPS: OrderStatus[] = ["new", "accepted", "preparing", "ready", "completed"];
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = { new: "新訂單", accepted: "已接單", preparing: "製作中", ready: "可取餐", completed: "已完成", cancelled: "已取消" };
/** Orders still in the kitchen queue (counted for "前面還有幾單"). */
const QUEUE_STATUSES: OrderStatus[] = ["new", "accepted", "preparing"];
const LOGIN_CODE_MINUTES = 10;
const LOGIN_CODE_ATTEMPTS = 5;
const MAX_PHOTO = 5 * 1024 * 1024;
// At most 40 chunks + metadata per upload, under D1 Free's 50-query limit.
const PHOTO_CHUNK_BYTES = 128 * 1024;
/** Chunks fetched per D1 query when streaming a stored photo (5 queries for a 5 MB image instead of 40). */
const PHOTO_CHUNKS_PER_QUERY = 8;
const MEDIA_CACHE = "public, max-age=31536000, immutable";
export const STATE_VERSION = 2;
/** Bounded collections keep every stored row and every write small. */
export const TRUCK_LIMITS = { sources: 100, posts: 200, stalls: 200, menu: 100, orders: 300, members: 300, coupons: 200, campaigns: 100, activity: 100 } as const;
/** Field limits shared with the merchant/customer forms (tests assert the forms never allow more). */
export const TRUCK_FIELD_LIMITS = {
  sourceTitle: 100, sourceContent: 20000, postTitle: 100, postCaption: 10000, postTopic: 500, cardTitle: 60,
  stallTitle: 100, stallLocation: 200, stallNotes: 2000, menuName: 100, menuCategory: 40, menuDescription: 1000,
  menuPriceMax: 100000, customerName: 40, orderNote: 1000, couponCode: 20, couponLabel: 60, campaignTitle: 60, campaignMessage: 500,
  brandName: 60, brandDescription: 1000, district: 20
} as const;
/** Actions a customer page may perform; everything else is merchant-only. */
export const CUSTOMER_ACTIONS = new Set(["order.create", "member.join", "member.profile", "coupon.check"]);
/** Actions answered from the current state without writing anything. */
export const READ_ONLY_ACTIONS = new Set(["coupon.check"]);
const ARCHETYPES: [string, string, number, string][] = [
  ["caregiver", "照顧者", 92, "在意顧客和夥伴，服務細心、讓人放心。"],
  ["everyman", "凡人", 86, "像巷口熟悉的小吃攤，沒有距離感。"],
  ["explorer", "探險家", 78, "每次出車換個地點，認識不同的客人。"],
  ["creator", "創造者", 67, "願意嘗試新菜色和新的呈現方式。"],
  ["innocent", "天真者", 64, "說話簡單直接，不誇張。"],
  ["hero", "英雄", 60, "強調克服困難、把事情做好。"],
  ["jester", "小丑", 55, "語氣輕鬆，偶爾開點玩笑。"],
  ["lover", "愛人", 51, "重視吃東西時的感受和氣氛。"],
  ["sage", "智者", 47, "把餐點、份量和流程講清楚。"],
  ["magician", "魔法師", 43, "強調驚喜和轉變。"],
  ["ruler", "統治者", 36, "重視標準、品質一致和秩序。"],
  ["outlaw", "叛逆者", 30, "不照常規走，有自己的態度。"]
];
export const ARCHETYPE_IDS = ARCHETYPES.map(([id]) => id);

/** Content rotation used by quick start, the idle-post assistant and topic inference. */
export const TOPICS: { key: string; label: string; topic: string; keywords: RegExp }[] = [
  { key: "stall", label: "出車預告", topic: "本週出車預告：時間、地點與預訂方式", keywords: /出車|出攤|預告|市集|地點|擺攤/ },
  { key: "signature", label: "招牌菜推薦", topic: "推薦一道招牌菜", keywords: /招牌|推薦|必吃|人氣/ },
  { key: "team", label: "夥伴日常", topic: "夥伴備餐的日常", keywords: /夥伴|團隊|日常|員工|備餐/ },
  { key: "thanks", label: "顧客感謝", topic: "謝謝來吃的大家", keywords: /謝謝|感謝|捧場|回饋/ },
  { key: "offer", label: "會員優惠", topic: "會員專屬優惠活動", keywords: /優惠|折扣|會員|買一送一|活動|折價/ },
  { key: "behind", label: "食材與備料", topic: "今天的食材與備料", keywords: /食材|備料|新鮮|產地|料理/ },
  { key: "story", label: "品牌故事", topic: "我們為什麼開這台餐車", keywords: /故事|理念|初衷|使命|為什麼/ },
  { key: "seasonal", label: "季節限定", topic: "季節限定的暖心餐點", keywords: /季節|限定|冬|夏|秋|春|節日|節慶/ }
];
export const GENDERS = ["女", "男", "其他", "不透露"];
export const INCOMES = ["2 萬以下", "2–4 萬", "4–6 萬", "6–8 萬", "8–10 萬", "10 萬以上", "不透露"];
export const OCCUPATIONS = ["學生", "上班族", "服務業", "自由工作者", "軍公教", "自營／老闆", "家管", "退休", "其他"];
export const HOUSEHOLDS = ["單身", "情侶／已婚無子女", "有小孩", "與家人同住", "其他"];
export const CHANNELS = ["Instagram", "Facebook", "路過看到", "朋友推薦", "市集／活動", "其他"];
export const DIETS = ["素食", "不吃辣", "不吃牛", "海鮮過敏", "少油少鹽"];
export const CITIES = ["台北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "台中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "台南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣", "澎湖縣", "金門縣", "連江縣"];
const DEFAULT_SETTINGS: TruckSettings = { profileReward: 30, profileRewardDays: 30, rfm: { loyalOrders: 3, activeDays: 30, churnDays: 45, bigOrder: 250 }, ordering: { paused: false, message: "" }, calendarLabels: [], labelRules: {} };
/** A label id the calendar knows (built-in or the merchant's own); empty means the default for that kind of event. */
function labelId(state: TruckState, value: unknown, fallback: "post" | "stall"): string {
  if (value === undefined || value === null || value === "") return fallback;
  const id = text(value, "標籤", 100);
  if (![...BUILTIN_LABELS, ...state.settings.calendarLabels].some(label => label.id === id)) throw new HttpError("找不到這個標籤，請重新選擇。", 400);
  return id;
}

const L = TRUCK_FIELD_LIMITS;
function uuid(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function record(value: unknown): Payload { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Payload : {}; }
function text(value: unknown, label: string, max = 300, required = true): string {
  if (typeof value !== "string") { if (required) throw new HttpError(`請填寫${label}。`, 400); return ""; }
  const result = value.trim();
  if (required && !result) throw new HttpError(`請填寫${label}。`, 400);
  if (result.length > max) throw new HttpError(`${label}最多 ${max} 個字。`, 400);
  return result;
}
/** Lenient text for model output: trims and truncates instead of rejecting. */
function clean(value: unknown, max: number): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function cleanList(value: unknown, max: number, itemMax: number): string[] {
  return Array.isArray(value) ? value.map(item => clean(item, itemMax)).filter(Boolean).slice(0, max) : [];
}
function phone(value: unknown, required: boolean): string {
  const normalized = text(value, "手機號碼", 30, false).replace(/[\s()-]/g, "").replace(/^\+886/, "0");
  if (!normalized && required) throw new HttpError("請填寫手機號碼。", 400);
  if (normalized && !/^09\d{8}$/.test(normalized)) throw new HttpError("請填寫有效的台灣手機號碼（09 開頭共 10 碼）。", 400);
  return normalized;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) throw new HttpError(`${label}須為 ${min} 至 ${max} 的整數。`, 400);
  return number;
}
function imageUrl(value: unknown, required = false): string {
  const url = text(value, "圖片網址", 2048, required);
  if (!url) return "";
  if (url.startsWith("/static/") || /^\/api\/truck\/media\/[a-zA-Z0-9_.-]+$/.test(url) || url.startsWith("/artifacts/")) return url;
  try { if (new URL(url).protocol === "https:") return url; } catch { /* report below */ }
  throw new HttpError("圖片網址必須為 HTTPS 或已上傳的圖片。", 400);
}
export function taipeiDate(instant: string, offset = 0): string { return new Date(Date.parse(instant) + (8 + offset * 24) * 3600000).toISOString().slice(0, 10); }
function isoOffset(instant: string, hours: number): string { return new Date(Date.parse(instant) + hours * 3600000).toISOString(); }
function daysSince(instant: string | null | undefined, now: string): number {
  const time = Date.parse(String(instant || ""));
  return Number.isFinite(time) ? Math.floor((Date.parse(now) - time) / 86400000) : Number.POSITIVE_INFINITY;
}
function find<T extends { id: string }>(items: T[], id: unknown, label: string): T {
  const key = text(id, `${label}編號`, 100);
  const item = items.find(row => row.id === key);
  if (!item) throw new HttpError(`找不到${label}。`, 404);
  return item;
}
function activity(state: TruckState, message: string, type: string, now: string): void {
  state.activity.unshift({ id: uuid("activity"), text: message, date: now, type });
  state.activity = state.activity.slice(0, TRUCK_LIMITS.activity);
}
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function couponCode(prefix: string, taken: Set<string>): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = `${prefix}${Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("")}`;
    if (!taken.has(code)) return code;
  }
}
export function isSoldOut(item: Pick<MenuItem, "soldOutOn">, now: string): boolean { return item.soldOutOn === taipeiDate(now); }
export function profileComplete(demographics: Demographics | null | undefined): boolean {
  return Boolean(demographics && demographics.gender && demographics.birthYear && demographics.city && demographics.occupation && demographics.income);
}
export function inferTopicKey(topic: string): string {
  return TOPICS.find(entry => entry.keywords.test(topic))?.key || "other";
}
/** Quick-start categories outside the rotation: a content pillar, today's hot topic, a seasonal idea. */
export const EXTRA_TOPIC_KEYS = ["pillar", "trend", "season"] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Brand DNA libraries (tone, audience) and the 一般餐車 baseline
// ---------------------------------------------------------------------------------------------------------------------
export const TONE_IDS = TONES.map(tone => tone.id);
export const AUDIENCE_IDS = AUDIENCES.map(audience => audience.id);
export const AI_BASELINE_IDS = BASELINE.filter(row => row.method === "ai").map(row => row.id);
type Judgement = { store: string; verdict: Verdict };
const NO_DATA = "資料不足，補充品牌資料後重新診斷。";
export const audienceText = (entries: AudienceEntry[]): string[] => entries.map(entry => entry.situation ? `${entry.label}：${entry.situation}` : entry.label);
/** Baseline lines judged from the truck's own records (menu, members, posts, stalls). */
export function dataComparison(state: TruckState, now: string): Map<string, Judgement> {
  const rows = new Map<string, Judgement>();
  const listed = state.menu.filter(item => item.available);
  rows.set("ordering", listed.length
    ? { store: "可以線上先點、到場取餐；顧客手機看得到前面還有幾單，餐好了會震動通知。", verdict: "advantage" }
    : { store: "還沒有上架餐點，顧客暫時無法線上點餐。", verdict: "unknown" });
  const members = state.members.length;
  const offers = state.coupons.some(coupon => coupon.active) || state.campaigns.length > 0;
  rows.set("membership", members
    ? { store: `已有 ${members} 位會員${offers ? "，提供專屬折扣碼與推播優惠" : "，還沒有推出回訪優惠"}。`, verdict: offers ? "advantage" : "similar" }
    : { store: "點餐頁已開放加入會員，目前還沒有會員。", verdict: "similar" });
  const since = Date.parse(now) - 30 * 86400000;
  const recent = state.posts.filter(post => post.status === "published" && Date.parse(post.publishedAt || "") >= since).length;
  rows.set("social", recent >= 6 ? { store: `近 30 天發了 ${recent} 篇，更新比一般餐車頻繁。`, verdict: "advantage" }
    : recent >= 2 ? { store: `近 30 天發了 ${recent} 篇，和一般餐車差不多。`, verdict: "similar" }
      : { store: `近 30 天只發了 ${recent} 篇，可以用貼文工作區固定發文。`, verdict: "weaker" });
  const today = taipeiDate(now);
  const soon = state.stalls.filter(stall => stall.date >= today && stall.date <= taipeiDate(now, 14)).length;
  rows.set("schedule", soon ? { store: `未來兩週已排定 ${soon} 場出攤，顧客在點餐頁就看得到時間地點。`, verdict: "advantage" }
    : { store: "未來兩週還沒有排定出攤，顧客不知道去哪裡找你。", verdict: "weaker" });
  const english = listed.filter(item => item.nameEn.trim()).length;
  rows.set("language", listed.length && english * 2 >= listed.length ? { store: `${english}/${listed.length} 道餐點有英文菜單，顧客可以切換 English 點餐。`, verdict: "advantage" }
    : { store: english ? `只有 ${english}/${listed.length} 道餐點有英文。` : "還沒有英文菜單。", verdict: "similar" });
  return rows;
}
/** Keyword estimate of the AI-judged lines, used when the LLM is unavailable. */
function ruleJudgements(state: TruckState, evidence: string): Map<string, Judgement> {
  const rows = new Map<string, Judgement>();
  const listed = state.menu.filter(item => item.available);
  if (listed.length) {
    rows.set("signature", { store: `主打${listed.slice(0, 3).map(item => item.name).join("、")}。`, verdict: "similar" });
    const average = Math.round(listed.reduce((sum, item) => sum + item.price, 0) / listed.length);
    rows.set("price", { store: `菜單平均 NT$${average}。`, verdict: "similar" });
  }
  if (/現點現做|現炒|現做|當天|新鮮|在地|產地/.test(evidence)) rows.set("ingredients", { store: "資料中強調現點現做、當天備料。", verdict: "advantage" });
  if (/故事|理念|使命|初衷|培訓|公益|友善就業/.test(evidence)) rows.set("story", { store: "有對外說明的品牌故事與理念。", verdict: "advantage" });
  if (/市集|活動|校園|園區|演唱會|廟會/.test(evidence)) rows.set("venue", { store: "常出現在市集、校園或活動現場，接觸不同客群。", verdict: "advantage" });
  return rows;
}
/** The full 一般餐車 comparison in baseline order; the advantages become the differentiation. */
function buildComparison(state: TruckState, now: string, judged: Map<string, Judgement>, basis: "ai" | "rules"): ComparisonRow[] {
  const measured = dataComparison(state, now);
  return BASELINE.map(base => {
    const row = base.method === "data" ? measured.get(base.id) : judged.get(base.id);
    return { id: base.id, label: base.label, typical: base.typical, store: row?.store || NO_DATA, verdict: row?.verdict || "unknown", basis: base.method === "data" ? "data" : basis };
  });
}
const advantages = (rows: ComparisonRow[]): string[] => rows.filter(row => row.verdict === "advantage").map(row => `${row.label}：${row.store}`);
/** The 時事 offer the model suggested for a hook, kept within sane bounds (NT$5–100 off, or 5–50% off; code A–Z/0–9). */
function trendOffer(raw: Payload, today: string): TrendOffer | null {
  const kind = raw.offerKind === "percent" ? "percent" : raw.offerKind === "amount" ? "amount" : null;
  const value = Math.round(Number(raw.offerValue));
  if (!kind || !Number.isFinite(value) || value <= 0) return null;
  const bounded = kind === "percent" ? Math.max(5, Math.min(50, value)) : Math.max(5, Math.min(100, value));
  const code = String(raw.offerCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const fallback = kind === "percent" ? `全單 ${100 - bounded} 折` : `結帳折 NT$${bounded}`;
  return { label: clean(raw.offerLabel, 40) || `時事限定：${fallback}`, kind, value: bounded, code: code.length >= 3 ? code : `HOT${today.slice(5).replace("-", "")}` };
}
/** Makes sure a post that goes with a discount code tells customers the code, what it gives and until when. */
function withCouponLine(caption: string, coupon: Coupon): string {
  if (caption.includes(coupon.code)) return caption;
  const until = coupon.expiresAt ? `（${taipeiDate(coupon.expiresAt).slice(5).replace("-", "/")} 前有效）` : "";
  const line = `🎟 結帳輸入折扣碼 ${coupon.code}：${coupon.label}${until}`;
  const tags = /\n\n(#[^\n]+)$/.exec(caption);
  return tags ? `${caption.slice(0, tags.index)}\n\n${line}${tags[0]}` : `${caption}\n\n${line}`;
}
/** Post topics for a pillar the model (or an older diagnosis) left without any. */
function pillarTopics(title: string, detail: string): string[] {
  return [`${title}：這週想跟大家分享的事`, detail ? detail.replace(/[。！]$/, "").slice(0, 30) : `${title}的幕後故事`];
}

// ---------------------------------------------------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------------------------------------------------
const FLAGSHIP_MENU: MenuItem[] = [
  { id: "demo-menu-main", name: "海陸炒泡麵", price: 100, category: "炒泡麵", description: "鮮蝦、蛋和蔬菜一起大火快炒。", image: "", available: true, soldOutOn: null, nameEn: "Surf & Turf Stir-fried Noodles", descriptionEn: "Instant noodles wok-fried with shrimp, egg and vegetables.", categoryEn: "Stir-fried Noodles" },
  { id: "demo-menu-pasta", name: "番茄肉醬義大利麵", price: 120, category: "義大利麵", description: "番茄肉醬配花椰菜。", image: "", available: true, soldOutOn: null, nameEn: "Tomato Meat Sauce Spaghetti", descriptionEn: "Spaghetti with tomato meat sauce and broccoli.", categoryEn: "Pasta" },
  { id: "demo-menu-udon", name: "日式炒烏龍麵", price: 110, category: "烏龍麵", description: "蝦仁和蔬菜一起快炒的烏龍麵。", image: "", available: true, soldOutOn: null, nameEn: "Japanese Stir-fried Udon", descriptionEn: "Udon stir-fried with shrimp and vegetables.", categoryEn: "Udon" }
];
type SeedMember = [id: string, name: string, phone: string, joinedDaysAgo: number, demographics: Demographics | null];
const FLAGSHIP_MEMBERS: SeedMember[] = [
  ["demo-member-001", "林小姐", "0911111111", 40, { gender: "女", birthYear: 1993, city: "台北市", district: "內湖區", occupation: "上班族", income: "4–6 萬", household: "單身", diet: ["不吃辣"], channel: "Instagram" }],
  ["demo-member-002", "陳先生", "0922222222", 30, { gender: "男", birthYear: 1988, city: "台北市", district: "中山區", occupation: "上班族", income: "6–8 萬", household: "有小孩", diet: [], channel: "朋友推薦" }],
  ["demo-member-003", "吳同學", "0933333333", 9, null],
  ["demo-member-004", "張媽媽", "0944444444", 95, { gender: "女", birthYear: 1971, city: "新北市", district: "板橋區", occupation: "家管", income: "不透露", household: "有小孩", diet: ["少油少鹽"], channel: "市集／活動" }],
  ["demo-member-005", "王先生", "0955555555", 65, null],
  ["demo-member-006", "李小姐", "0966666666", 35, { gender: "女", birthYear: 1998, city: "台北市", district: "大安區", occupation: "服務業", income: "2–4 萬", household: "與家人同住", diet: [], channel: "Instagram" }],
  ["demo-member-007", "黃同學", "0977777777", 4, null],
  ["demo-member-008", "周先生", "0988888888", 2, null],
  ["demo-member-009", "許小姐", "0912000111", 90, { gender: "女", birthYear: 1985, city: "台北市", district: "松山區", occupation: "軍公教", income: "4–6 萬", household: "情侶／已婚無子女", diet: [], channel: "Facebook" }],
  ["demo-member-010", "鄭先生", "0912000222", 28, { gender: "男", birthYear: 1990, city: "新北市", district: "汐止區", occupation: "自營／老闆", income: "8–10 萬", household: "有小孩", diet: ["不吃牛"], channel: "路過看到" }]
];
/** [member index or null for a guest, days ago, items as [menu index, quantity]] */
const FLAGSHIP_HISTORY: [number | null, number, [number, number][]][] = [
  [0, 2, [[0, 1], [2, 1]]], [0, 9, [[0, 1]]], [0, 16, [[1, 1]]], [0, 24, [[0, 2]]],
  [1, 5, [[1, 2]]], [1, 20, [[2, 1]]],
  [2, 6, [[0, 2], [1, 1], [2, 1]]],
  [3, 70, [[2, 2]]], [3, 85, [[0, 1]]],
  [4, 60, [[1, 1]]],
  [5, 1, [[2, 1]]], [5, 6, [[0, 1]]], [5, 12, [[1, 1]]], [5, 19, [[0, 1], [1, 1]]], [5, 27, [[2, 1]]],
  [6, 3, [[0, 1]]],
  [8, 50, [[0, 1]]], [8, 63, [[1, 2]]], [8, 78, [[2, 1]]],
  [9, 4, [[1, 1]]], [9, 11, [[0, 1], [2, 1]]], [9, 25, [[0, 1]]],
  [null, 2, [[1, 1]]], [null, 8, [[0, 3]]]
];

function defaultAssistant(): AssistantState { return { lastCheckAt: null, suggestionPostId: null, topicKey: null, idleDays: 0, reason: "" }; }
function emptyDemographics(): Demographics { return { gender: "", birthYear: null, city: "", district: "", occupation: "", income: "", household: "", diet: [], channel: "" }; }
function orderNumber(day: string, sequence: number): string { return `H${day.replace(/-/g, "").slice(4)}-${String(sequence).padStart(3, "0")}`; }

export function seedTruckState(now = new Date().toISOString()): TruckState {
  const today = taipeiDate(now);
  const tomorrow = taipeiDate(now, 1);
  const menu = structuredClone(FLAGSHIP_MENU);
  const members: Member[] = FLAGSHIP_MEMBERS.map(([id, name, phoneNumber, joined, demographics]) => ({
    id, name, phone: phoneNumber, lineBound: true, createdAt: isoOffset(now, -24 * joined - 3), demographics: demographics ? { ...emptyDemographics(), ...demographics } : null,
    profileAt: demographics ? isoOffset(now, -24 * joined) : null, consentAt: demographics ? isoOffset(now, -24 * joined) : null, optIn: true
  }));
  const perDay = new Map<string, number>();
  const history: Order[] = FLAGSHIP_HISTORY.map(([memberIndex, daysAgo, lines], index) => {
    const createdAt = isoOffset(now, -24 * daysAgo - 2 - (index % 5));
    const day = taipeiDate(createdAt);
    const sequence = (perDay.get(day) || 0) + 1; perDay.set(day, sequence);
    const items = lines.map(([menuIndex, quantity]) => { const item = menu[menuIndex]!; return { menuId: item.id, name: item.name, price: item.price, quantity }; });
    const member = memberIndex === null ? null : members[memberIndex]!;
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return {
      id: `demo-hist-${String(index + 1).padStart(3, "0")}`, number: orderNumber(day, sequence),
      customer: member ? { name: member.name, phone: member.phone, lineBound: true } : { name: index % 2 ? "Amy" : "小宇", phone: index % 2 ? "0923456789" : "0934567890", lineBound: false },
      items, subtotal, discount: null, total: subtotal, status: "completed", createdAt, note: "", memberId: member?.id ?? null
    };
  });
  const current: Order[] = [
    { id: "demo-order-001", number: "D001", customer: { name: "林小姐", phone: "0911111111", lineBound: true }, items: [{ menuId: "demo-menu-main", name: "海陸炒泡麵", price: 100, quantity: 1 }], subtotal: 100, discount: null, total: 100, status: "new", createdAt: isoOffset(now, -0.15), note: "少辣", memberId: "demo-member-001" },
    { id: "demo-order-002", number: "D002", customer: { name: "Amy", phone: "0923456789", lineBound: false }, items: [{ menuId: "demo-menu-pasta", name: "番茄肉醬義大利麵", price: 120, quantity: 2 }], subtotal: 240, discount: null, total: 240, status: "preparing", createdAt: isoOffset(now, -0.3), note: "", memberId: null },
    { id: "demo-order-003", number: "D003", customer: { name: "吳同學", phone: "0933333333", lineBound: true }, items: [{ menuId: "demo-menu-udon", name: "日式炒烏龍麵", price: 110, quantity: 2 }], subtotal: 220, discount: null, total: 220, status: "completed", createdAt: isoOffset(now, -1), note: "", memberId: "demo-member-003" }
  ];
  const churned = ["demo-member-004", "demo-member-005", "demo-member-009"];
  const seeded: TruckState = {
    brand: {
      name: "海海人生行動餐車", shortName: "海海人生", category: "行動餐車", description: "新巨輪透過行動餐車培訓身心障礙者餐飲技能，創造穩定、友善的工作環境，支持自立生活。", location: "台灣",
      tagline: "新巨輪 · 共融就業餐車", since: "2020", nameEn: "Hai Hai Life Food Truck",
      descriptionEn: "Run by Hsin Chu Lun, our food truck trains people with disabilities in culinary skills and creates stable, friendly jobs that support independent living.",
      coverImage: "/static/truck/brand/truck-official.webp", instagram: "https://www.instagram.com/hsinchulun_foodtruck/", website: "https://www.hsinchulun.org/新巨輪-海海人生行動餐車介紹/"
    },
    sources: [
      { id: "demo-source-brand", title: "新巨輪官方｜餐車介紹", type: "brand", content: "海海人生行動餐車由新巨輪推動，培訓身心障礙者餐飲技能，創造穩定、友善且有尊嚴的工作機會，支持自立生活。官方使命來源（2020 開幕）：https://www.hsinchulun.org/新巨輪首創無礙餐車正式開幕！讓障礙者重拾尊嚴/ 。餐點介紹（2021）：https://www.hsinchulun.org/新巨輪-海海人生行動餐車介紹/ 。", status: "analyzed", createdAt: now },
      { id: "demo-source-social", title: "Instagram 品牌入口", type: "instagram", content: "品牌 Instagram：https://www.instagram.com/hsinchulun_foodtruck/。可連結 Meta 帳號後匯入既有貼文，讓品牌診斷參考實際文案。", status: "ready", createdAt: now },
      { id: "demo-source-voice", title: "品牌語氣設定", type: "note", content: "語氣親切、不煽情，像跟熟客聊天。貼文要寫清楚出車時間、地點和取餐方式。", status: "analyzed", createdAt: now }
    ],
    archetypes: ARCHETYPES.map(([id, label, score, description]) => ({ id, label, score, description })),
    diagnosis: {
      status: "ready", generatedAt: now, positioning: "培訓身心障礙夥伴的餐飲技能，透過穩定的餐車工作支持自立生活。", tone: ["溫暖親切", "友善共融", "資訊清楚"],
      toneNote: "用平常講話的口氣，多寫餐點和夥伴的實際狀況，少喊口號。", audience: [], audiences: SEED_AUDIENCES,
      differentiation: [], comparison: [],
      pillars: [
        { title: "出車資訊", detail: "時間、地點、預訂方式寫清楚，前一天發預告。", topics: ["本週出車時間與地點總整理", "下雨天也照常出車：線上先點不用排隊"] },
        { title: "招牌餐點", detail: "海陸炒泡麵、義大利麵等現做餐點的特寫與份量。", topics: ["海陸炒泡麵從下鍋到上桌的 3 分鐘", "一份 NT$100 的份量開箱"] },
        { title: "夥伴的日常", detail: "備料與出餐的過程，用平常口吻記錄成長。", topics: ["夥伴第一次獨立掌煎台的那天", "早上七點的備料現場"] },
        { title: "顧客與會員", detail: "感謝熟客、分享會員優惠，邀請大家再來。", topics: ["謝謝熟客留給夥伴的一句話", "會員專屬折扣碼怎麼用"] }
      ],
      summary: "根據新巨輪官網介紹和語氣設定，主要人格是照顧者，其次是凡人和探險家：對夥伴和顧客都細心，說話像跟熟客聊天，每次出車在不同地點。新增資料後可以重新診斷。", feedbackAt: null, engine: "rules"
    },
    posts: [
      { id: "demo-post-draft", platform: "instagram", title: "這週出車預告", topic: "週末出攤提醒", topicKey: "stall", caption: "這週海海人生要出車囉！\n海陸炒泡麵、番茄肉醬義大利麵都有，現點現做。\n時間地點會在前一天公布，可以先線上預訂，到了直接取餐。\n\n#海海人生 #行動餐車", image: "/static/truck/brand/truck-official.webp", cardTitle: "", status: "draft", createdAt: now, scheduledAt: null, publishedAt: null, metrics: null, mode: "demo" },
      { id: "demo-post-scheduled", platform: "facebook", title: "明天市集見", topic: "出攤公告", topicKey: "stall", caption: "明天下午海海人生在週末市集，14:00 到 18:00。\n想少排一點隊，可以先線上點餐，到了報名字取餐。", image: "/static/truck/brand/truck-official.webp", cardTitle: "", status: "scheduled", createdAt: isoOffset(now, -3), scheduledAt: isoOffset(now, 24), publishedAt: null, metrics: null, mode: "demo" },
      { id: "demo-post-published", platform: "instagram", title: "謝謝今天來吃的大家", topic: "品牌日常", topicKey: "thanks", caption: "今天的日式炒烏龍很快就賣完了，謝謝大家捧場！\n夥伴們從早上備料忙到收攤，辛苦了。下次出車時間會再公告。", image: "/static/truck/brand/truck-official.webp", cardTitle: "", status: "published", createdAt: isoOffset(now, -48), scheduledAt: null, publishedAt: isoOffset(now, -24), metrics: { reach: 2480, likes: 186, comments: 24, saves: 61, clicks: 93, manual: true }, mode: "demo" },
      { id: "demo-post-history", platform: "instagram", title: "夥伴的備料日常", topic: "夥伴備餐的日常", topicKey: "team", caption: "早上七點，夥伴已經在切菜、備料。\n每一份海陸炒泡麵的蝦仁和蔬菜都是當天準備的。", image: "/static/truck/brand/truck-official.webp", cardTitle: "", status: "published", createdAt: isoOffset(now, -24 * 9), scheduledAt: null, publishedAt: isoOffset(now, -24 * 8), metrics: { reach: 1830, likes: 142, comments: 17, saves: 48, clicks: 51, manual: true }, mode: "demo" }
    ],
    stalls: [
      { id: "demo-stall-today", title: "午間出攤", date: today, start: "11:00", end: "14:00", location: "校園廣場", notes: "" },
      { id: "demo-stall-next", title: "午後市集", date: tomorrow, start: "14:00", end: "18:00", location: "週末市集", notes: "" }
    ],
    menu,
    orders: [...current, ...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    members,
    coupons: [
      { id: "demo-coupon-back", code: "BACK40", label: "好久不見回流禮 折 NT$40", kind: "amount", value: 40, itemId: null, minSpend: 100, memberIds: churned, maxUses: null, uses: 0, usedBy: [], expiresAt: isoOffset(now, 24 * 20), source: "campaign", campaignId: "demo-campaign-back", active: true, createdAt: isoOffset(now, -24 * 10) },
      { id: "demo-coupon-ig", code: "IG20", label: "IG 粉絲折 NT$20", kind: "amount", value: 20, itemId: null, minSpend: 150, memberIds: null, maxUses: 100, uses: 0, usedBy: [], expiresAt: isoOffset(now, 24 * 30), source: "manual", campaignId: null, active: true, createdAt: isoOffset(now, -24 * 5) }
    ],
    campaigns: [
      { id: "demo-campaign-back", segment: "churned", segmentLabel: "流失客", kind: "coupon", title: "好久不見，回來吃飯吧", message: "最近好嗎？海海人生想念你了！點餐輸入 BACK40 折 NT$40（滿 NT$100），期限內有效。", couponId: "demo-coupon-back", couponCode: "BACK40", recipients: churned, sentAt: isoOffset(now, -24 * 10) }
    ],
    activity: [{ id: "demo-activity-start", text: "工作台已準備完成", date: now, type: "system" }],
    trends: null, assistant: defaultAssistant(), settings: structuredClone(DEFAULT_SETTINGS),
    workspace: { version: STATE_VERSION, createdAt: isoOffset(now, -24 * 120) }, revision: 0
  };
  seeded.diagnosis.audience = audienceText(SEED_AUDIENCES);
  seeded.diagnosis.comparison = buildComparison(seeded, now, new Map(Object.entries(SEED_JUDGEMENTS)), "rules");
  seeded.diagnosis.differentiation = advantages(seeded.diagnosis.comparison);
  return seeded;
}
const SEED_AUDIENCES: AudienceEntry[] = [
  { label: "上班族午餐", situation: "出攤點附近的上班族，中午想先線上點好、到場直接取餐。" },
  { label: "市集遊客", situation: "週末逛市集時看到餐車，想吃一份現炒熱食。" },
  { label: "理念支持者", situation: "認同友善就業理念，願意特地來用消費支持夥伴。" }
];
const SEED_JUDGEMENTS: Record<string, Judgement> = {
  signature: { store: "炒泡麵、義大利麵、烏龍麵三種現炒麵食，主打海陸炒泡麵。", verdict: "similar" },
  ingredients: { store: "每一份都由受訓夥伴現點現做，蝦仁和蔬菜當天備料。", verdict: "advantage" },
  price: { store: "單品 NT$100–120，份量實在。", verdict: "similar" },
  story: { store: "由新巨輪推動，培訓身心障礙者餐飲技能、支持自立生活，理念清楚。", verdict: "advantage" },
  venue: { store: "常出現在市集、校園與活動現場，接觸不同客群。", verdict: "advantage" }
};

/** A new merchant account starts with its own empty workspace. */
export function blankTruckState(name: string, now = new Date().toISOString()): TruckState {
  const storeName = name.trim().slice(0, L.brandName) || "我的餐車";
  return {
    brand: { name: storeName, shortName: storeName.replace(/(行動)?餐車$/, "").trim().slice(0, 12) || storeName.slice(0, 12), category: "行動餐車", description: "", location: "", tagline: "", since: "", nameEn: "", descriptionEn: "", coverImage: "", instagram: "", website: "" },
    sources: [], archetypes: ARCHETYPES.map(([id, label, , description]) => ({ id, label, score: 0, description })),
    diagnosis: { status: "empty", generatedAt: now, positioning: "", tone: [], toneNote: "", audience: [], audiences: [], differentiation: [], comparison: [], pillars: [], summary: "", feedbackAt: null, engine: "rules" },
    posts: [], stalls: [], menu: [], orders: [], members: [], coupons: [], campaigns: [],
    activity: [{ id: uuid("activity"), text: `${storeName} 的工作台已建立`, date: now, type: "system" }],
    trends: null, assistant: defaultAssistant(), settings: structuredClone(DEFAULT_SETTINGS), workspace: { version: STATE_VERSION, createdAt: now }, revision: 0
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Content helpers (rule-based fallbacks used when the LLM is unavailable)
// ---------------------------------------------------------------------------------------------------------------------
function missionPresent(state: TruckState): boolean {
  return state.sources.some(row => row.status === "analyzed" && /培訓身心障礙者餐飲技能/.test(row.content));
}
function nextStall(state: TruckState, now: string): Stall | undefined {
  const today = taipeiDate(now);
  return [...state.stalls].filter(stall => stall.date >= today).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))[0];
}
export function ruleCaption(state: TruckState, platform: "instagram" | "facebook", topic: string, topicKey: string, now: string): string {
  const missionNote = missionPresent(state) ? "車上的夥伴都在這裡學餐飲技能、累積工作經驗，歡迎來給他們鼓勵。\n" : "";
  const dishes = state.menu.filter(item => item.available && !isSoldOut(item, now)).slice(0, 3).map(item => item.name);
  const menuNote = dishes.length ? `這次有${dishes.join("、")}，都是現點現做。\n` : "";
  const stall = nextStall(state, now);
  const stallNote = topicKey === "stall" && stall ? `📍 ${stall.date.slice(5).replace("-", "/")} ${stall.start}–${stall.end}｜${stall.location}\n` : "";
  const angle: Record<string, string> = {
    signature: "這道是很多熟客每次必點的餐，份量實在、趁熱吃最好吃。\n",
    team: "從備料、炒鍋到出餐，每個步驟都是夥伴一點一點練起來的。\n",
    thanks: "謝謝每一位來吃、來打招呼的你，你們的回饋我們都有看到。\n",
    offer: "加入會員就能收到專屬優惠，點餐時輸入折扣碼就能使用。\n",
    behind: "食材每天早上準備，蔬菜和蝦仁都在出車前處理好。\n",
    story: "開這台餐車，是想讓更多人吃到用心做的餐，也讓夥伴有穩定的舞台。\n",
    seasonal: "天氣變了，換季的時候來一份熱騰騰的餐最剛好。\n"
  };
  const tag = state.brand.shortName.replace(/[^\p{L}\p{N}]/gu, "");
  if (platform === "instagram") {
    return `${topic}\n\n${stallNote}${angle[topicKey] || ""}${menuNote}${missionNote}出車時間和地點以最新公告為準。想少排一點隊，可以先線上預訂，到了報名字取餐。\n\n#${tag} #行動餐車 #餐車美食`;
  }
  return `${topic}\n\n${stallNote}${angle[topicKey] || ""}${menuNote}${missionNote}${menuNote || missionNote ? "\n" : ""}可以先在線上點餐，餐車接單後手機上會顯示製作進度，好了再過來拿就好。實際出車時間與品項以${state.brand.shortName}最新公告為準。`;
}

export interface AiPost { title: string; caption: string; cardTitle: string }
function aiPost(value: unknown): AiPost | null {
  const input = record(value);
  const caption = clean(input.caption, L.postCaption);
  if (!caption) return null;
  return { title: clean(input.title, 50), caption, cardTitle: clean(input.cardTitle, L.cardTitle) };
}
function buildPost(state: TruckState, platform: "instagram" | "facebook", topic: string, topicKey: string, now: string, ai: AiPost | null, image?: string): Post {
  return {
    id: uuid("post"), platform, title: (ai?.title || topic).slice(0, 50), topic, topicKey, caption: ai?.caption || ruleCaption(state, platform, topic, topicKey, now),
    image: image ?? (state.brand.coverImage || "/static/truck/brand/truck-official.webp"), cardTitle: ai?.cardTitle || "", status: "draft", createdAt: now,
    scheduledAt: null, publishedAt: null, metrics: null, mode: "demo", engine: ai ? "ai" : "rules"
  };
}

/** Least recently used topic, preferring an outing preview when the truck is out within three days. */
export function pickTopic(state: TruckState, now: string): { key: string; label: string; topic: string; lastUsedDays: number } {
  const stall = nextStall(state, now);
  const lastUsed = (key: string) => {
    const dates = state.posts.filter(post => (post.topicKey || inferTopicKey(post.topic || post.title)) === key).map(post => post.publishedAt || post.scheduledAt || post.createdAt);
    return dates.length ? dates.sort().at(-1)! : null;
  };
  const stallTopic = TOPICS[0]!;
  if (stall && stall.date <= taipeiDate(now, 3) && daysSince(lastUsed("stall"), now) >= 2) {
    return { key: "stall", label: stallTopic.label, topic: `${stall.date.slice(5).replace("-", "/")} ${stall.location} 出車預告`, lastUsedDays: daysSince(lastUsed("stall"), now) };
  }
  const ranked = TOPICS.map(entry => ({ entry, used: lastUsed(entry.key) })).sort((a, b) => (a.used || "").localeCompare(b.used || ""));
  const choice = ranked[0]!;
  return { key: choice.entry.key, label: choice.entry.label, topic: choice.entry.topic, lastUsedDays: daysSince(choice.used, now) };
}

/** Whether the idle-post assistant should prepare a draft now. Pure, so the Durable Object can decide before calling the LLM. */
export function assistantPlan(state: TruckState, now: string, force = false): { suggest: false; reason: string } | { suggest: true; idleDays: number; topic: ReturnType<typeof pickTopic> } {
  if (!force && state.assistant.lastCheckAt && taipeiDate(state.assistant.lastCheckAt) === taipeiDate(now)) return { suggest: false, reason: "checked-today" };
  const pending = state.posts.find(post => post.id === state.assistant.suggestionPostId && post.status === "draft");
  if (pending && !force) return { suggest: false, reason: "pending-suggestion" };
  const future = state.posts.some(post => post.status === "scheduled" && post.scheduledAt && post.scheduledAt > now);
  const lastPublished = state.posts.map(post => post.publishedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
  const idleDays = Math.min(daysSince(lastPublished || state.workspace.createdAt, now), 365);
  if (!force && (future || idleDays < 3)) return { suggest: false, reason: future ? "scheduled" : "recent" };
  return { suggest: true, idleDays: Number.isFinite(idleDays) ? idleDays : 0, topic: pickTopic(state, now) };
}

const TW_EVENTS: [string, string, string, string][] = [
  // [MM-DD or YYYY-MM-DD, title, why, topic]
  ["01-01", "元旦新年", "新年第一餐，適合發新年問候與今年出車計畫。", "新年快樂！今年的出車計畫"],
  ["2027-01-23", "尾牙季", "公司聚餐、團購需求增加，可以推團體預訂。", "尾牙季團體預訂"],
  ["2027-02-06", "農曆春節", "春節前後出車時間調整要提早公告。", "春節出車與休假公告"],
  ["02-14", "西洋情人節", "兩人同行、分享餐點的話題好發揮。", "情人節兩人同行優惠"],
  ["04-04", "兒童節", "親子客群出遊多，適合主打家庭份量。", "兒童節親子餐點推薦"],
  ["05-10", "母親節前後", "感謝媽媽的溫暖話題，適合品牌故事。", "母親節：謝謝每一位媽媽"],
  ["2026-06-19", "端午節", "連假出遊人潮，適合公告出車地點。", "端午連假出車資訊"],
  ["08-08", "父親節", "感謝爸爸的話題，可搭配大份量餐點。", "父親節：帶爸爸來吃一份"],
  ["2026-09-25", "中秋節", "烤肉與聚會季，適合外帶與團購。", "中秋聚會外帶推薦"],
  ["09-28", "教師節", "校園客群，可以感謝老師。", "教師節：謝謝老師"],
  ["10-31", "萬聖節", "活動、市集多，造型與限定話題好互動。", "萬聖節限定活動"],
  ["11-11", "雙 11", "優惠話題熱度高，適合會員專屬折扣。", "雙 11 會員專屬折扣"],
  ["12-22", "冬至", "吃熱食、暖身的話題，適合熱湯麵類。", "冬至來一份熱騰騰的餐"],
  ["12-25", "聖誕節", "節慶聚會與交換禮物，適合限定活動。", "聖誕節限定活動"],
  ["12-31", "跨年", "跨年活動與年終感謝。", "謝謝今年來吃的每一位"]
];
/** Calendar, season and own-performance trends (no external data is fabricated). */
export function calendarTrends(state: TruckState, now: string): Trend[] {
  const today = taipeiDate(now);
  const year = Number(today.slice(0, 4));
  const horizon = taipeiDate(now, 45);
  const items: Trend[] = [];
  for (const [when, title, why, topic] of TW_EVENTS) {
    const dates = when.length === 10 ? [when] : [`${year}-${when}`, `${year + 1}-${when}`];
    const date = dates.find(value => value >= today && value <= horizon);
    if (date) items.push({ id: `cal-${date}`, title, why: `${date.slice(5).replace("-", "/")}｜${why}`, topic, hashtags: [title.replace(/\s/g, ""), "行動餐車"], kind: "holiday", date });
  }
  items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const month = Number(today.slice(5, 7));
  const season = month >= 11 || month <= 2 ? ["秋冬暖食季", "天氣轉涼，熱炒、湯麵和現做熱食的需求上升。", "天冷了，來一份熱騰騰的現炒"]
    : month >= 6 && month <= 8 ? ["夏日消暑", "高溫時段排隊意願低，強調線上預訂、到場即取。", "天氣熱不用排隊：先線上點餐"]
      : month >= 5 && month <= 6 ? ["梅雨季", "下雨天外出意願低，提醒出車資訊與外帶方便性。", "下雨天也有出車：線上點好直接取"]
        : ["春秋出遊季", "戶外活動與市集多，適合公告出攤行程。", "這個週末的市集出車行程"];
  items.push({ id: "season", title: season[0]!, why: season[1]!, topic: season[2]!, hashtags: [season[0]!.replace(/\s/g, ""), "餐車美食"], kind: "season", date: null });
  const ranked = state.posts.filter(post => post.status === "published" && post.metrics)
    .map(post => ({ post, score: Number(post.metrics?.likes || 0) + Number(post.metrics?.comments || 0) * 2 + Number(post.metrics?.saves || 0) * 2 }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best) {
    const label = TOPICS.find(entry => entry.key === (best.post.topicKey || inferTopicKey(best.post.topic)))?.label || "同類主題";
    items.push({ id: "insight-best", title: `本店高互動：${label}`, why: `「${best.post.title}」互動最高，可以延續相同主題與寫法。`, topic: best.post.topic || best.post.title, hashtags: [state.brand.shortName.replace(/[^\p{L}\p{N}]/gu, "")], kind: "insight", date: null });
  }
  const stale = pickTopic(state, now);
  items.push({ id: "insight-stale", title: `久未發布：${stale.label}`, why: Number.isFinite(stale.lastUsedDays) ? `已經 ${stale.lastUsedDays} 天沒有發這類主題。` : "還沒有發過這類主題，可以補上。", topic: stale.topic, hashtags: [], kind: "insight", date: null });
  return items.slice(0, 8);
}

// ---------------------------------------------------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------------------------------------------------
export interface CouponCheck { ok: boolean; code: string; amount: number; label: string; error?: string; couponId?: string; minSpend?: number }
function priceItems(state: TruckState, rawItems: unknown, now: string, strict: boolean): OrderItem[] {
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 50) throw new HttpError("請選擇 1 至 50 個餐點項目。", 400);
  const quantities = new Map<string, number>();
  for (const raw of rawItems) {
    const item = record(raw); const menu = find(state.menu, item.menuId, "餐點");
    if (strict && (!menu.available || isSoldOut(menu, now))) throw new HttpError(`「${menu.name}」目前已售完。`, 400);
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new HttpError("每項餐點數量須為 1 至 99 的整數。", 400);
    const quantity = (quantities.get(menu.id) || 0) + item.quantity;
    if (quantity > 99) throw new HttpError("同一餐點最多可預訂 99 份。", 400);
    quantities.set(menu.id, quantity);
  }
  return [...quantities].map(([id, quantity]) => { const menu = find(state.menu, id, "餐點"); return { menuId: menu.id, name: menu.name, price: menu.price, quantity }; });
}
export function evaluateCoupon(state: TruckState, rawCode: unknown, items: OrderItem[], who: { memberId: string | null; phone: string }, now: string): CouponCheck {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase().slice(0, L.couponCode) : "";
  const fail = (error: string): CouponCheck => ({ ok: false, code, amount: 0, label: "", error });
  if (!code) return fail("請輸入折扣碼。");
  const coupon = state.coupons.find(row => row.code === code);
  if (!coupon || !coupon.active) return fail("找不到這個折扣碼，請確認大小寫與拼字。");
  if (coupon.expiresAt && coupon.expiresAt < now) return fail("這個折扣碼已過期。");
  if (coupon.maxUses !== null && coupon.uses >= coupon.maxUses) return fail("這個折扣碼已被使用完畢。");
  if (coupon.memberIds && (!who.memberId || !coupon.memberIds.includes(who.memberId))) return fail("這是會員專屬折扣碼，請以收到優惠的會員身分點餐。");
  if (coupon.usedBy.includes(who.memberId || "") || (who.phone && coupon.usedBy.includes(who.phone))) return fail("你已經使用過這個折扣碼。");
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (subtotal < coupon.minSpend) return fail(`消費滿 NT$${coupon.minSpend} 才能使用這個折扣碼。`);
  let amount = 0;
  if (coupon.kind === "amount") amount = coupon.value;
  else if (coupon.kind === "percent") amount = Math.round(subtotal * coupon.value / 100);
  else {
    const line = items.find(item => item.menuId === coupon.itemId);
    if (!line || line.quantity < 2) {
      const name = state.menu.find(item => item.id === coupon.itemId)?.name || "指定餐點";
      return fail(`買一送一需要點 2 份「${name}」。`);
    }
    amount = line.price * Math.floor(line.quantity / 2);
  }
  amount = Math.max(0, Math.min(subtotal, amount));
  return { ok: true, code, amount, label: coupon.label, couponId: coupon.id, minSpend: coupon.minSpend };
}
/** Gives a discount use back to the customer (cancelled order). */
function releaseCoupon(state: TruckState, order: Order): void {
  if (!order.discount) return;
  const coupon = state.coupons.find(row => row.id === order.discount!.couponId);
  if (!coupon) return;
  coupon.uses = Math.max(0, coupon.uses - 1);
  const who = order.memberId || order.customer.phone;
  const index = coupon.usedBy.lastIndexOf(who);
  if (index >= 0) coupon.usedBy.splice(index, 1);
}
function couponFromOffer(state: TruckState, raw: unknown, base: { label?: string; memberIds: string[] | null; source: Coupon["source"]; campaignId: string | null; now: string; days: number; code?: string }): Coupon {
  const offer = record(raw);
  const kind = offer.kind === "percent" || offer.kind === "bogo" ? offer.kind : "amount";
  const value = kind === "bogo" ? 0 : kind === "percent" ? integer(offer.value, "折扣百分比", 1, 90) : integer(offer.value, "折扣金額", 1, 5000);
  const itemId = kind === "bogo" ? find(state.menu, offer.itemId, "買一送一餐點").id : null;
  const minSpend = offer.minSpend === undefined || offer.minSpend === "" ? 0 : integer(offer.minSpend, "最低消費", 0, 100000);
  const itemName = itemId ? state.menu.find(item => item.id === itemId)?.name : "";
  const label = base.label || (kind === "bogo" ? `${itemName} 買一送一` : kind === "percent" ? `全單 ${100 - value} 折` : `折 NT$${value}`) + (minSpend ? `（滿 NT$${minSpend}）` : "");
  const taken = new Set(state.coupons.map(coupon => coupon.code));
  let code = base.code ? text(base.code, "折扣碼", L.couponCode).toUpperCase() : couponCode(kind === "bogo" ? "BOGO" : "VIP", taken);
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new HttpError("折扣碼只能使用 3 至 20 個英文字母或數字。", 400);
  if (taken.has(code)) throw new HttpError("這個折扣碼已經存在，請換一個。", 409);
  if (state.coupons.length >= TRUCK_LIMITS.coupons) state.coupons = state.coupons.filter(coupon => coupon.active).slice(0, TRUCK_LIMITS.coupons - 1);
  code = code.toUpperCase();
  return {
    id: uuid("coupon"), code, label: label.slice(0, L.couponLabel), kind, value, itemId, minSpend, memberIds: base.memberIds, maxUses: null, uses: 0, usedBy: [],
    expiresAt: base.days ? isoOffset(base.now, base.days * 24) : null, source: base.source, campaignId: base.campaignId, active: true, createdAt: base.now
  };
}
function demographicsFrom(raw: unknown, now: string): Demographics | null {
  const input = record(raw);
  if (!Object.keys(input).length) return null;
  const pick = (value: unknown, options: string[], label: string) => {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string" || !options.includes(value)) throw new HttpError(`請從選項中選擇${label}。`, 400);
    return value;
  };
  const year = Number(taipeiDate(now).slice(0, 4));
  const birthYear = input.birthYear === undefined || input.birthYear === null || input.birthYear === "" ? null : integer(input.birthYear, "出生年", 1920, year - 8);
  const diet = Array.isArray(input.diet) ? [...new Set(input.diet.filter((value): value is string => typeof value === "string" && DIETS.includes(value)))] : [];
  const city = pick(typeof input.city === "string" ? input.city.replace(/臺/g, "台") : input.city, CITIES, "居住縣市");
  // The district must belong to the chosen city (the customer page offers only that city's districts).
  const district = text(input.district, "行政區", L.district, false).replace(/臺/g, "台");
  if (district && !city) throw new HttpError("請先選擇居住縣市，再選擇行政區。", 400);
  if (district && !TW_DISTRICTS[city]?.includes(district)) throw new HttpError(`${city}沒有「${district}」，請重新選擇行政區。`, 400);
  return {
    gender: pick(input.gender, GENDERS, "性別"), birthYear, city, district,
    occupation: pick(input.occupation, OCCUPATIONS, "職業"), income: pick(input.income, INCOMES, "月收入"), household: pick(input.household, HOUSEHOLDS, "家庭狀況"),
    diet, channel: pick(input.channel, CHANNELS, "得知管道")
  };
}
/**
 * Saves demographics and, the first time the core profile is complete, issues the member's reward code.
 * `replace` (the member editing their own profile) also clears optional answers they removed.
 */
function applyProfile(state: TruckState, member: Member, raw: unknown, consent: boolean, now: string, replace = false): Coupon | null {
  const demographics = demographicsFrom(raw, now);
  if (!demographics) return null;
  if (!consent && !member.consentAt) throw new HttpError("填寫會員資料前，請先勾選同意個人資料使用說明。", 400);
  const wasComplete = profileComplete(member.demographics);
  const answered = Object.fromEntries(Object.entries(demographics).filter(([, value]) => value !== "" && value !== null && !(Array.isArray(value) && !value.length)));
  member.demographics = { ...emptyDemographics(), ...(replace ? {} : member.demographics || {}), ...answered } as Demographics;
  // A district kept from an earlier answer must still belong to the (possibly new) city.
  if (member.demographics.district && !TW_DISTRICTS[member.demographics.city]?.includes(member.demographics.district)) member.demographics.district = "";
  member.consentAt = member.consentAt || now;
  if (!profileComplete(member.demographics)) return null;
  member.profileAt = member.profileAt || now;
  const already = state.coupons.some(coupon => coupon.source === "profile" && coupon.memberIds?.includes(member.id));
  if (wasComplete || already || state.settings.profileReward <= 0) return null;
  const coupon = couponFromOffer(state, { kind: "amount", value: state.settings.profileReward }, { label: `會員資料完成禮 折 NT$${state.settings.profileReward}`, memberIds: [member.id], source: "profile", campaignId: null, now, days: state.settings.profileRewardDays });
  coupon.code = couponCode("HI", new Set(state.coupons.map(row => row.code)));
  coupon.maxUses = 1;
  state.coupons.unshift(coupon);
  return coupon;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------------------------------------
/** Pure domain transition. Returned state is detached from the caller's state. */
export function applyTruckAction(input: TruckState, type: string, rawPayload: unknown = {}, now = new Date().toISOString(), extras: ActionExtras = {}): ActionResult {
  const state = structuredClone(input);
  const payload = record(rawPayload);
  const result: Record<string, unknown> = {};
  if (extras.aiError) result.aiNotice = extras.aiError;
  switch (type) {
    case "source.add": {
      const source: TruckSource = { id: uuid("source"), title: text(payload.title, "來源名稱", L.sourceTitle), type: text(payload.type || "note", "來源類型", 40), content: text(payload.content, "來源內容", L.sourceContent), status: "ready", createdAt: now };
      if (state.sources.length >= TRUCK_LIMITS.sources) throw new HttpError(`工作台最多可保存 ${TRUCK_LIMITS.sources} 筆來源，請先刪除不需要的資料。`, 400);
      state.sources.unshift(source); result.source = source;
      activity(state, `新增品牌資料：${source.title}`, "source", now); break;
    }
    case "source.update": {
      const source = find(state.sources, payload.id, "資料來源");
      if (payload.title !== undefined) source.title = text(payload.title, "來源名稱", L.sourceTitle);
      if (payload.type !== undefined) source.type = text(payload.type, "來源類型", 40);
      source.content = text(payload.content, "來源內容", L.sourceContent); source.status = "ready"; source.updatedAt = now;
      result.source = source; activity(state, `更新品牌資料：${source.title}`, "source", now); break;
    }
    case "source.delete": {
      const source = find(state.sources, payload.id, "資料來源");
      state.sources = state.sources.filter(row => row.id !== source.id); result.id = source.id;
      activity(state, `刪除品牌資料：${source.title}`, "source", now); break;
    }
    case "source.import": {
      const prepared = record(extras.prepared);
      const rawItems = Array.isArray(prepared.items) ? prepared.items : payload.kind === "batch" && Array.isArray(payload.items) ? payload.items : [];
      const items = rawItems.slice(0, 20).map(raw => {
        const item = record(raw);
        return { title: clean(item.title, L.sourceTitle) || "匯入資料", type: clean(item.type, 40) || "manual", content: clean(item.content, L.sourceContent) };
      }).filter(item => item.content);
      if (!items.length) throw new HttpError("沒有可匯入的內容，請確認檔案或圖片內容。", 400);
      if (state.sources.length + items.length > TRUCK_LIMITS.sources) throw new HttpError(`工作台最多可保存 ${TRUCK_LIMITS.sources} 筆來源，請先刪除不需要的資料。`, 400);
      const added = items.map(item => ({ id: uuid("source"), ...item, status: "ready" as const, createdAt: now }));
      state.sources.unshift(...added); result.sources = added; result.imported = added.length;
      activity(state, `匯入 ${added.length} 筆品牌資料`, "source", now); break;
    }
    case "source.analyze": {
      const sources = payload.id ? [find(state.sources, payload.id, "資料來源")] : state.sources;
      for (const source of sources) source.status = "analyzed";
      result.analyzed = sources.length; activity(state, `已分析 ${sources.length} 筆來源`, "diagnosis", now); break;
    }
    case "diagnosis.run": {
      if (!state.sources.length && !state.posts.some(post => post.meta?.imported)) throw new HttpError("請先新增品牌資料來源。", 400);
      const imported = state.posts.filter(post => post.meta?.imported);
      const feedback = state.sources.filter(source => source.mode === "meta" && source.type === "performance");
      const sources = imported.length || feedback.length ? state.sources.filter(source => source.type !== "performance" || source.mode === "meta") : state.sources;
      for (const source of sources) source.status = "analyzed";
      const ai = record(extras.ai);
      // The model may only pick from the libraries; anything else is dropped.
      const aiTones = [...new Set(cleanList(ai.tone, 8, 30))].map(id => TONES.find(tone => tone.id === id)?.label).filter((label): label is string => Boolean(label)).slice(0, 5);
      const aiReady = clean(ai.positioning, 400) && aiTones.length;
      if (aiReady) {
        const scores = new Map((Array.isArray(ai.archetypes) ? ai.archetypes : []).map(row => [clean(record(row).id, 20), Number(record(row).score)]));
        state.archetypes = ARCHETYPES.map(([id, label, base, description]) => {
          const score = scores.get(id);
          return { id, label, score: typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : base, description };
        });
        const audiences = (Array.isArray(ai.audiences) ? ai.audiences : []).map(raw => {
          const row = record(raw); const entry = AUDIENCES.find(audience => audience.id === clean(row.id, 40));
          return entry ? { label: entry.label, situation: clean(row.situation, 80) } : null;
        }).filter((row, index, list): row is AudienceEntry => Boolean(row) && list.findIndex(other => other?.label === row!.label) === index).slice(0, 3);
        const judged = new Map<string, Judgement>();
        for (const raw of Array.isArray(ai.comparison) ? ai.comparison : []) {
          const row = record(raw); const id = clean(row.id, 40); const store = clean(row.store, 120);
          if (AI_BASELINE_IDS.includes(id) && store) judged.set(id, { store, verdict: row.verdict === "advantage" || row.verdict === "similar" ? row.verdict : "unknown" });
        }
        const comparison = buildComparison(state, now, judged, "ai");
        state.diagnosis = {
          status: "ready", generatedAt: now, positioning: clean(ai.positioning, 400), tone: aiTones, toneNote: clean(ai.toneNote, 300),
          audience: audienceText(audiences), audiences, differentiation: advantages(comparison), comparison,
          pillars: (Array.isArray(ai.pillars) ? ai.pillars : []).map(raw => {
            const row = record(raw); const title = clean(row.title, 30); const detail = clean(row.detail, 160);
            const topics = cleanList(row.topics, 3, 60);
            return { title, detail, topics: topics.length ? topics : pillarTopics(title, detail) };
          }).filter(row => row.title).slice(0, 5),
          summary: clean(ai.summary, 800), feedbackAt: state.diagnosis.feedbackAt, engine: "ai"
        };
      } else {
        const evidence = [...sources.map(source => source.content), ...imported.map(post => post.caption)].join("\n");
        const hasWarmth = /溫暖|照顧|友善|陪伴|支持/.test(evidence);
        const hasTravel = /出攤|餐車|街角|移動|市集/.test(evidence);
        const hasMission = /培訓身心障礙者餐飲技能/.test(evidence);
        const hasPreorder = /預訂|預約|線上|取餐/.test(evidence);
        const dishes = state.menu.filter(item => item.available).slice(0, 2).map(item => item.name);
        state.archetypes = ARCHETYPES.map(([id, label, base, description]) => ({ id, label, score: Math.min(98, base + (id === "caregiver" && hasWarmth ? 3 : 0) + (id === "explorer" && hasTravel ? 5 : 0)), description }));
        // Keyword estimate, still limited to the libraries.
        const toneIds = ["warm", hasMission ? "inclusive" : /幽默|好笑|有趣|俏皮/.test(evidence) ? "playful" : "honest", "clear", ...(/職人|手作|堅持|現做|現炒/.test(evidence) ? ["craft"] : [])];
        const audienceIds = [/學生|校園/.test(evidence) ? "students" : "office-lunch", hasTravel ? "market-goers" : "regulars", hasMission || /理念|公益|環保/.test(evidence) ? "social-good" : "commuters"];
        const audiences = audienceIds.map(id => AUDIENCES.find(entry => entry.id === id)!).map(entry => ({ label: entry.label, situation: entry.definition }));
        const comparison = buildComparison(state, now, ruleJudgements(state, evidence), "rules");
        const pillars = [{ title: "出車資訊", detail: "時間、地點、預訂方式寫清楚，前一天發預告。", topics: ["本週出車時間與地點總整理", hasPreorder ? "線上先點、到場取餐怎麼用" : "第一次來怎麼找到我們"] }, { title: "招牌餐點", detail: dishes.length ? `${dishes.join("、")}的特寫與份量。` : "主力餐點的特寫與份量。", topics: dishes.length ? [`${dishes[0]}從下鍋到上桌`, `一份${dishes[0]}的份量開箱`] : ["招牌餐點從下鍋到上桌", "一份餐的份量開箱"] }, hasMission ? { title: "夥伴的日常", detail: "備料與出餐的過程，用平常口吻記錄成長。", topics: ["夥伴第一次獨立掌煎台的那天", "早上七點的備料現場"] } : { title: "品牌故事", detail: "為什麼開這台餐車、堅持什麼。", topics: ["我們為什麼開這台餐車", "一件我們一直堅持的小事"] }, { title: "顧客與會員", detail: "感謝熟客、分享會員優惠，邀請大家再來。", topics: ["謝謝熟客留給我們的一句話", "會員專屬折扣碼怎麼用"] }];
        state.diagnosis = {
          status: "ready", generatedAt: now,
          positioning: hasMission ? `${state.brand.shortName}：培訓身心障礙夥伴的餐飲技能，透過穩定的餐車工作支持自立生活。` : `${state.brand.shortName}：在不同地點出車的行動餐車，可以線上預訂、現場取餐。`,
          tone: [...new Set(toneIds)].map(id => TONES.find(tone => tone.id === id)!.label), toneNote: "用平常講話的口氣，多寫餐點和現場的實際狀況，少喊口號。",
          audience: audienceText(audiences), audiences, differentiation: advantages(comparison), comparison,
          pillars,
          summary: `參考 ${sources.length} 筆來源${imported.length ? `與 ${imported.length} 則匯入貼文` : ""}。${feedback.length ? `其中 ${feedback.length} 筆為 Meta 實際成效回饋。` : ""}主要人格是照顧者，其次是凡人${hasTravel ? "和探險家" : ""}。${hasMission ? "提到夥伴時用平常的口吻，不刻意煽情；" : ""}貼文要寫清楚出車時間、地點和預訂方式。`,
          feedbackAt: state.diagnosis.feedbackAt, engine: "rules"
        };
      }
      result.diagnosis = state.diagnosis; result.engine = state.diagnosis.engine; activity(state, "已重新建立 Brand DNA", "diagnosis", now); break;
    }
    case "post.generate": {
      const platform = payload.platform || "instagram";
      if (platform !== "instagram" && platform !== "facebook") throw new HttpError("請選擇 Instagram 或 Facebook。", 400);
      const topic = text(payload.topic, "貼文主題", L.postTopic);
      const trend = typeof payload.trendId === "string" ? state.trends?.items.find(item => item.id === payload.trendId && item.kind === "hot") : undefined;
      const hook = trend && typeof payload.hookId === "string" ? trend.hooks?.find(item => item.id === payload.hookId) : undefined;
      // A 時事 discount code created for this post (any active code of this truck can be mentioned).
      const wanted = typeof payload.couponCode === "string" ? payload.couponCode.trim().toUpperCase() : "";
      const coupon = wanted ? state.coupons.find(row => row.code === wanted && row.active) : undefined;
      if (wanted && !coupon) throw new HttpError(`找不到可以使用的折扣碼 ${wanted}，請到會員管理確認。`, 400);
      const known = (key: unknown) => typeof key === "string" && (TOPICS.some(entry => entry.key === key) || (EXTRA_TOPIC_KEYS as readonly string[]).includes(key));
      const topicKey = trend ? "trend" : known(payload.topicKey) ? payload.topicKey as string : inferTopicKey(topic);
      if (state.posts.filter(item => item.mode === "meta").length >= TRUCK_LIMITS.posts) throw new HttpError("工作台的貼文已達儲存上限。", 409);
      const post = buildPost(state, platform, topic, topicKey, now, aiPost(extras.ai), payload.image === undefined ? undefined : imageUrl(payload.image));
      // A post written from a hot topic keeps the sources and the risk warning for the owner (never published in the caption).
      if (trend) {
        post.trend = { title: trend.title, angle: hook?.angle || trend.why, riskLevel: trend.riskLevel || "medium", riskNote: trend.riskNote || "", sources: trend.sources || [], ...(trend.summary ? { summary: trend.summary } : {}), ...(hook ? { hook: { title: hook.title, angle: hook.angle, offer: hook.offer } } : {}), ...(coupon ? { couponCode: coupon.code } : {}) };
        if (hook && post.engine === "rules") post.caption = `${hook.title}！\n\n${post.caption}`;
      }
      if (coupon) post.caption = withCouponLine(post.caption, coupon);
      state.posts.unshift(post); result.post = post; result.engine = post.engine;
      activity(state, `已產生 ${platform === "instagram" ? "Instagram" : "Facebook"} 草稿：${post.title}`, "content", now); break;
    }
    case "assistant.check": {
      const plan = assistantPlan(state, now, payload.force === true);
      if (!plan.suggest) {
        if (plan.reason === "checked-today" || plan.reason === "pending-suggestion") return { state: input, result: { skipped: plan.reason }, noop: true };
        state.assistant = { ...state.assistant, lastCheckAt: now, reason: plan.reason };
        result.skipped = plan.reason; break;
      }
      const previous = state.posts.find(post => post.id === state.assistant.suggestionPostId && post.status === "draft" && post.suggested);
      if (previous) state.posts = state.posts.filter(post => post.id !== previous.id);
      const platform = payload.platform === "facebook" ? "facebook" : "instagram";
      const post = { ...buildPost(state, platform, plan.topic.topic, plan.topic.key, now, aiPost(extras.ai)), suggested: true };
      state.posts.unshift(post);
      state.assistant = { lastCheckAt: now, suggestionPostId: post.id, topicKey: plan.topic.key, idleDays: plan.idleDays, reason: "idle" };
      result.post = post; result.engine = post.engine;
      activity(state, `已 ${plan.idleDays} 天沒有發文，系統準備了「${plan.topic.label}」草稿`, "assistant", now); break;
    }
    case "assistant.dismiss": {
      const post = state.posts.find(row => row.id === state.assistant.suggestionPostId);
      if (post && post.status === "draft" && post.suggested && payload.discard === true) state.posts = state.posts.filter(row => row.id !== post.id);
      else if (post) delete post.suggested;
      state.assistant = { ...state.assistant, suggestionPostId: null };
      result.dismissed = true; break;
    }
    case "trends.refresh": {
      // Hot topics come only from the server-side fetch (extras.prepared), never from the client payload.
      const today = taipeiDate(now);
      const prepared = record(extras.prepared);
      const signals = record(prepared.signals);
      // Reference links come only from the fetched feeds (by the id the model cites), never from the model's text.
      const linkOf = (raw: unknown): TrendSource | null => {
        const row = record(raw); const url = clean(row.url, 2048);
        return /^https?:\/\//i.test(url) ? { title: clean(row.title, 160) || url, url, source: clean(row.source, 60) } : null;
      };
      const refs = new Map<string, TrendSource[]>();
      for (const raw of Array.isArray(signals.headlines) ? signals.headlines : []) { const row = record(raw); const link = linkOf(row); if (link && typeof row.id === "string") refs.set(row.id, [link]); }
      const searches = (Array.isArray(signals.searches) ? signals.searches : []).map(record);
      for (const row of searches) if (typeof row.id === "string") refs.set(row.id, (Array.isArray(row.sources) ? row.sources : []).map(linkOf).filter((link): link is TrendSource => Boolean(link)).slice(0, 2));
      const newsSearch = (name: string): TrendSource => ({ title: `Google 新聞：${name}`, url: `https://news.google.com/search?q=${encodeURIComponent(name)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`, source: "Google 新聞" });
      const levels = ["low", "medium", "high"] as const;
      const genericRisk = "還沒有 AI 協助判斷這個話題，請先點開來源新聞確認事件內容，再決定要不要搭。";
      const aiTopics = (Array.isArray(record(extras.ai).topics) ? record(extras.ai).topics as unknown[] : []).map(record);
      let topics: Trend[] = aiTopics.map((row, index) => {
        const name = clean(row.name, 30);
        const id = `hot-${today}-${index + 1}`;
        const riskLevel = levels.find(level => level === row.riskLevel) ?? "medium";
        const sources = [...new Map(cleanList(row.refs, 10, 10).flatMap(ref => refs.get(ref) || []).map(link => [link.url, link])).values()].slice(0, 3);
        const hooks: TrendHook[] = riskLevel === "high" ? [] : (Array.isArray(row.hooks) ? row.hooks : []).map(record).map((hook, n) => ({
          id: `${id}-k${n + 1}`, title: clean(hook.title, 40), angle: clean(hook.angle, 160), topic: clean(hook.topic, L.postTopic) || clean(hook.title, 40), offer: trendOffer(hook, today)
        })).filter(hook => hook.title).slice(0, 3);
        return {
          id, title: name, kind: "hot" as const, date: today, summary: clean(row.summary, 160), buzz: Math.max(1, Math.min(5, Math.round(Number(row.buzz) || 1))),
          riskLevel, riskNote: clean(row.riskNote, 240) || genericRisk, sources: sources.length ? sources : [newsSearch(name)], hooks,
          why: hooks[0]?.angle || clean(row.summary, 160), topic: hooks[0]?.topic || `今天大家都在聊「${name}」`,
          hashtags: riskLevel === "high" ? [] : cleanList(row.hashtags, 3, 30).map(tag => tag.replace(/^#/, ""))
        };
      }).filter(topic => topic.title);
      const fromModel = topics.length > 0;
      if (!fromModel) {
        // Without the model: the top search spikes, each with one plain hook and a small offer to start from.
        topics = searches.slice(0, 3).map((row, index) => {
          const name = clean(row.title, 30);
          const id = `hot-${today}-${index + 1}`;
          const hook: TrendHook = { id: `${id}-k1`, title: `大家都在聊「${name}」`, angle: "輕鬆帶到這個話題，再推薦一道招牌餐點。", topic: `今天大家都在聊「${name}」`, offer: { label: "時事限定：結帳折 NT$10", kind: "amount", value: 10, code: `HOT${today.slice(5).replace("-", "")}` } };
          const links = refs.get(String(row.id)) || [];
          return { id, title: name, kind: "hot" as const, date: today, traffic: clean(row.traffic, 20), buzz: 3 - index, riskLevel: "medium" as const, riskNote: genericRisk, sources: links.length ? links : [newsSearch(name)], hooks: [hook], why: hook.angle, topic: hook.topic, hashtags: [] };
        }).filter(topic => topic.title);
      }
      // 最熱又最好玩的前三; high-risk topics are listed separately (with sources) but never suggested.
      const byBuzz = (a: Trend, b: Trend) => (b.buzz || 0) - (a.buzz || 0);
      const fresh = topics.filter(topic => topic.riskLevel !== "high").sort(byBuzz).slice(0, 3);
      const avoid = topics.filter(topic => topic.riskLevel === "high").sort(byBuzz).slice(0, 3);
      const sameDay = state.trends?.date === today;
      const items = fresh.length ? fresh : sameDay ? state.trends!.items : [];
      const seasonal = calendarTrends(state, now).filter(item => item.kind === "holiday" || item.kind === "season");
      const error = items.length ? "" : clean(prepared.error, 200) || "今天的熱門話題暫時抓不到，稍後再按「更新」。";
      state.trends = { generatedAt: now, date: today, items, avoid: fresh.length || avoid.length ? avoid : sameDay ? state.trends!.avoid : [], seasonal, engine: fresh.length && fromModel ? "ai" : "rules", ...(error ? { error } : {}) };
      result.trends = state.trends; result.engine = state.trends.engine; break;
    }
    case "label.save": {
      const name = text(payload.name, "標籤名稱", 8);
      if (typeof payload.color !== "string" || !LABEL_COLORS.includes(payload.color)) throw new HttpError("請從色票選擇一個顏色。", 400);
      const labels = state.settings.calendarLabels;
      const existing = payload.id ? find(labels, payload.id, "標籤") : null;
      if ([...BUILTIN_LABELS, ...labels].some(label => label.name === name && label.id !== existing?.id)) throw new HttpError(`已經有「${name}」這個標籤了。`, 409);
      if (!existing && labels.length >= MAX_CUSTOM_LABELS) throw new HttpError(`最多可以建立 ${MAX_CUSTOM_LABELS} 個自訂標籤，請先刪除用不到的。`, 400);
      const label = existing ? Object.assign(existing, { name, color: payload.color }) : { id: uuid("label"), name, color: payload.color };
      if (!existing) labels.push(label);
      result.label = label; activity(state, `${existing ? "已更新" : "已新增"}行事曆標籤：${name}`, "settings", now); break;
    }
    case "label.delete": {
      const label = find(state.settings.calendarLabels, payload.id, "標籤");
      state.settings.calendarLabels = state.settings.calendarLabels.filter(row => row.id !== label.id);
      // Events that used it go back to the default colour for their kind.
      for (const post of state.posts) if (post.label === label.id) delete post.label;
      for (const stall of state.stalls) if (stall.label === label.id) delete stall.label;
      for (const [key, value] of Object.entries(state.settings.labelRules)) if (value === label.id) delete state.settings.labelRules[key];
      result.id = label.id; activity(state, `已刪除行事曆標籤：${label.name}`, "settings", now); break;
    }
    case "post.update": {
      let post = find(state.posts, payload.id, "貼文");
      if (post.meta?.status === "unknown" || post.meta?.status === "publishing" || post.meta?.status === "queued") {
        throw new HttpError("請先取消排程或確認 Meta 發文結果，再修改內容。", 409);
      }
      if (post.mode === "meta" && post.status === "published") {
        if (state.posts.filter(item => item.mode === "meta").length >= TRUCK_LIMITS.posts) throw new HttpError("工作台的貼文已達儲存上限。", 409);
        post = { ...post, id: uuid("post"), createdAt: now };
        state.posts.unshift(post);
      }
      if (post.mode === "meta") {
        post.mode = "demo";
        delete post.meta;
      }
      if (payload.title !== undefined) post.title = text(payload.title, "貼文標題", L.postTitle);
      if (payload.caption !== undefined) post.caption = text(payload.caption, "貼文文案", L.postCaption);
      if (payload.image !== undefined) post.image = imageUrl(payload.image);
      if (payload.cardTitle !== undefined) post.cardTitle = text(payload.cardTitle, "圖片標題卡", L.cardTitle, false);
      post.status = "draft"; post.scheduledAt = null; post.publishedAt = null; post.metrics = null;
      result.post = post; activity(state, `已修改草稿（需重新確認）：${post.title}`, "content", now); break;
    }
    case "post.delete": {
      const post = find(state.posts, payload.id, "貼文");
      if (post.mode === "meta" && post.meta && ["queued", "publishing", "unknown"].includes(post.meta.status)) throw new HttpError("請先取消 Meta 排程或確認發文結果，再刪除。", 409);
      state.posts = state.posts.filter(row => row.id !== post.id);
      if (state.assistant.suggestionPostId === post.id) state.assistant = { ...state.assistant, suggestionPostId: null };
      result.id = post.id; activity(state, `已刪除貼文：${post.title}`, "content", now); break;
    }
    case "post.approve": {
      const post = find(state.posts, payload.id, "貼文");
      if (post.status !== "draft") throw new HttpError("只有草稿可以進行審核。", 409);
      post.status = "approved"; delete post.suggested;
      if (state.assistant.suggestionPostId === post.id) state.assistant = { ...state.assistant, suggestionPostId: null };
      result.post = post; activity(state, `已確認貼文：${post.title}`, "approval", now); break;
    }
    case "post.schedule": {
      const post = find(state.posts, payload.id, "貼文");
      if (post.mode === "meta") throw new HttpError("請使用 Meta 排程。", 409);
      if (post.status !== "approved" && post.status !== "scheduled") throw new HttpError("請先完成貼文審核，再設定排程。", 409);
      const raw = text(payload.scheduledAt, "排程時間", 80);
      const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw) ? `${raw}+08:00` : raw;
      const time = Date.parse(zoned);
      if (!Number.isFinite(time) || time <= Date.parse(now)) throw new HttpError("請選擇未來的排程時間。", 400);
      post.status = "scheduled"; post.scheduledAt = new Date(time).toISOString();
      if (payload.label !== undefined) {
        const label = labelId(state, payload.label, "post");
        if (label === "post") delete post.label; else post.label = label;
        // Remember the choice for this kind of post: the next one of the same category starts with this label.
        if (post.topicKey) { if (label === "post") delete state.settings.labelRules[post.topicKey]; else state.settings.labelRules[post.topicKey] = label; }
      }
      result.post = post;
      activity(state, `已排程：${post.title}`, "schedule", now); break;
    }
    case "post.label": {
      // Calendar colour of a post (also for Meta-scheduled posts, whose schedule goes through the Meta queue).
      const post = find(state.posts, payload.id, "貼文");
      const label = labelId(state, payload.label, "post");
      if (label === "post") delete post.label; else post.label = label;
      if (post.topicKey) { if (label === "post") delete state.settings.labelRules[post.topicKey]; else state.settings.labelRules[post.topicKey] = label; }
      result.post = post; break;
    }
    case "post.publish": {
      const post = find(state.posts, payload.id, "貼文");
      if (post.mode === "meta") throw new HttpError("請使用 Meta 發布。", 409);
      if (post.status !== "approved" && post.status !== "scheduled") throw new HttpError("請先完成貼文審核，再標記為已發布。", 409);
      post.status = "published"; post.publishedAt = now; post.metrics = null;
      result.post = post; activity(state, `已發布：${post.title}`, "publish", now); break;
    }
    case "post.metrics": {
      const post = find(state.posts, payload.id, "貼文");
      if (post.mode === "meta") throw new HttpError("Meta 貼文的成效會自動同步。", 409);
      if (post.status !== "published") throw new HttpError("貼文發布後才能填寫成效。", 409);
      const metric = (key: string, label: string) => integer(payload[key] ?? 0, label, 0, 100000000);
      post.metrics = { reach: metric("reach", "觸及"), likes: metric("likes", "按讚"), comments: metric("comments", "留言"), saves: metric("saves", "收藏"), clicks: metric("clicks", "連結點擊"), manual: true, fetchedAt: now };
      result.post = post; activity(state, `已更新貼文成效：${post.title}`, "analytics", now); break;
    }
    case "stall.save": {
      const date = text(payload.date, "出攤日期", 10);
      const start = text(payload.start, "開始時間", 5); const end = text(payload.end, "結束時間", 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00+08:00`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new HttpError("出攤日期格式不正確。", 400);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) throw new HttpError("結束時間必須晚於開始時間。", 400);
      const previous = payload.id ? find(state.stalls, payload.id, "出攤行程") : null;
      const label = payload.label !== undefined ? labelId(state, payload.label, "stall") : previous?.label || "stall";
      const stall: Stall = { id: previous?.id || uuid("stall"), title: text(payload.title, "出攤名稱", L.stallTitle), date, start, end, location: text(payload.location, "出攤地點", L.stallLocation), notes: text(payload.notes, "備註", L.stallNotes, false), ...(label !== "stall" ? { label } : {}) };
      if (previous && label === "stall") delete previous.label;
      if (!previous && state.stalls.length >= TRUCK_LIMITS.stalls) throw new HttpError(`工作台最多可保存 ${TRUCK_LIMITS.stalls} 筆出攤行程。`, 400);
      if (previous) Object.assign(previous, stall); else state.stalls.push(stall);
      state.stalls.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)); result.stall = stall;
      activity(state, `已儲存出攤行程：${stall.title}`, "stall", now); break;
    }
    case "stall.delete": {
      const stall = find(state.stalls, payload.id, "出攤行程");
      state.stalls = state.stalls.filter(row => row.id !== stall.id); result.id = stall.id;
      activity(state, `已刪除出攤行程：${stall.title}`, "stall", now); break;
    }
    case "member.save":
    case "member.join": {
      const name = text(payload.name, "取餐稱呼", L.customerName);
      const number = phone(payload.phone, true);
      let member = state.members.find(row => row.phone === number);
      // From the customer page, an existing phone only signs in on the device that already holds this membership
      // or with the one-time code the truck hands over in person; otherwise anyone could read and use the member's offers.
      if (member && type === "member.join" && payload.memberId !== member.id) {
        const entered = typeof payload.loginCode === "string" ? payload.loginCode.replace(/\s/g, "") : "";
        const issued = member.loginCode;
        if (!entered) throw new HttpError("這支手機已經是會員。為了保護會員資料，請向餐車人員索取 6 位數登入碼；也可以先用訪客身分點餐，訂單一樣會累積到會員紀錄。", 409);
        if (!issued || issued.expiresAt < now || issued.attempts >= LOGIN_CODE_ATTEMPTS) throw new HttpError("登入碼已失效，請向餐車人員重新索取。", 409);
        if (issued.code !== entered) {
          // The failed attempt is stored (five tries per code), so the reducer reports it instead of throwing.
          issued.attempts += 1;
          result.error = issued.attempts >= LOGIN_CODE_ATTEMPTS ? "登入碼錯誤次數過多，請向餐車人員重新索取。" : "登入碼不正確，請再確認一次。";
          result.loginRequired = true;
          break;
        }
        member.loginCode = null;
      }
      if (member) { member.name = name; member.lineBound = true; }
      else {
        member = { id: uuid("member"), name, phone: number, lineBound: true, createdAt: now, demographics: null, profileAt: null, consentAt: null, optIn: payload.optIn !== false };
        state.members.unshift(member);
      }
      if (payload.optIn !== undefined) member.optIn = payload.optIn === true;
      const reward = payload.demographics ? applyProfile(state, member, payload.demographics, payload.consent === true, now) : null;
      result.member = memberView(state, member); if (reward) result.reward = offerView(reward);
      activity(state, `${member.name} 加入會員${reward ? "並完成會員資料" : ""}`, "member", now); break;
    }
    case "member.profile": {
      const member = find(state.members, payload.memberId, "會員");
      // The member's own profile page sends the whole form, so answers they removed are cleared too.
      if (payload.name !== undefined) member.name = text(payload.name, "取餐稱呼", L.customerName);
      if (payload.optIn !== undefined) member.optIn = payload.optIn === true;
      const reward = applyProfile(state, member, payload.demographics, payload.consent === true, now, true);
      if (!profileComplete(member.demographics)) throw new HttpError("請填寫性別、出生年、居住縣市、職業與月收入，就能領取折扣碼。", 400);
      result.member = memberView(state, member); if (reward) result.reward = offerView(reward);
      activity(state, `${member.name} 更新了會員資料`, "member", now); break;
    }
    case "member.loginCode": {
      const member = find(state.members, payload.id, "會員");
      const digits = crypto.getRandomValues(new Uint32Array(1))[0]! % 1000000;
      member.loginCode = { code: String(digits).padStart(6, "0"), expiresAt: isoOffset(now, LOGIN_CODE_MINUTES / 60), attempts: 0 };
      result.code = member.loginCode.code; result.expiresAt = member.loginCode.expiresAt;
      activity(state, `已產生 ${member.name} 的會員登入碼`, "member", now); break;
    }
    case "member.delete": {
      const member = find(state.members, payload.id, "會員");
      state.members = state.members.filter(row => row.id !== member.id);
      for (const order of state.orders) if (order.memberId === member.id) order.memberId = null;
      result.id = member.id; activity(state, `已刪除會員：${member.name}`, "member", now); break;
    }
    case "order.create": {
      if (state.settings.ordering.paused) throw new HttpError(state.settings.ordering.message || "餐車目前暫停接單，請稍後再點，或直接到餐車現場點餐。", 409);
      const input = record(payload.customer);
      const member = payload.memberId ? find(state.members, payload.memberId, "會員") : null;
      const name = text(input.name, "取餐稱呼", L.customerName);
      const supplied = phone(input.phone, !member);
      if (member && supplied && member.phone !== supplied) throw new HttpError("會員資料與訂購人手機不一致。", 400);
      const items = priceItems(state, payload.items, now, true);
      const linked = member || state.members.find(row => row.phone === supplied) || null;
      const orderPhone = member?.phone || supplied;
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      let discount: OrderDiscount | null = null;
      if (typeof payload.couponCode === "string" && payload.couponCode.trim()) {
        const check = evaluateCoupon(state, payload.couponCode, items, { memberId: linked?.id || null, phone: orderPhone }, now);
        if (!check.ok || !check.couponId) throw new HttpError(check.error || "折扣碼無法使用。", 400);
        const coupon = state.coupons.find(row => row.id === check.couponId)!;
        coupon.uses += 1; coupon.usedBy.push(linked?.id || orderPhone);
        discount = { code: check.code, label: check.label, amount: check.amount, couponId: coupon.id };
      }
      // Next number = highest number already issued today + 1, so trimming old orders can never reuse a number.
      const prefix = `H${taipeiDate(now).replace(/-/g, "").slice(4)}-`;
      const issued = state.orders.filter(row => row.number.startsWith(prefix)).map(row => Number(row.number.slice(prefix.length)) || 0);
      const number = `${prefix}${String(Math.max(0, ...issued) + 1).padStart(3, "0")}`;
      const order: Order = {
        id: uuid("order"), number, customer: { name, phone: orderPhone, lineBound: Boolean(linked) }, items, subtotal, discount, total: subtotal - (discount?.amount || 0),
        status: "new", createdAt: now, updatedAt: now, note: text(payload.note, "訂單備註", L.orderNote, false), memberId: linked?.id || null
      };
      state.orders.unshift(order); result.order = order;
      activity(state, `新訂單 #${number}，NT$${order.total}${discount ? `（折扣碼 ${discount.code}）` : ""}`, "order", now); break;
    }
    case "order.status": {
      const order = find(state.orders, payload.id, "訂單");
      if (order.status === "cancelled") throw new HttpError("這筆訂單已取消，無法再更新狀態。", 409);
      const from = ORDER_STEPS.indexOf(order.status);
      const to = ORDER_STEPS.indexOf(payload.status as OrderStatus);
      // Forward one step (a new order may go straight to 製作中); back to an earlier step to undo a mis-tap
      // (a completed order only back to 可取餐).
      const forward = to === from + 1 || (order.status === "new" && payload.status === "preparing");
      const back = to >= 0 && to < from && (order.status !== "completed" || payload.status === "ready");
      if (!forward && !back) throw new HttpError("請依順序更新訂單：新訂單 → 已接單 → 製作中 → 可取餐 → 已完成。", 409);
      const next = ORDER_STEPS[to]!;
      order.status = next; order.updatedAt = now; result.order = order;
      activity(state, `訂單 #${order.number} ${back ? "已退回" : "已更新"}為${ORDER_STATUS_LABELS[next]}`, "order", now); break;
    }
    case "order.cancel": {
      const order = find(state.orders, payload.id, "訂單");
      if (order.status === "completed" || order.status === "cancelled") throw new HttpError("已完成或已取消的訂單無法取消。", 409);
      order.status = "cancelled"; order.updatedAt = now; order.cancelReason = text(payload.reason, "取消原因", 100, false);
      releaseCoupon(state, order);
      result.order = order;
      activity(state, `訂單 #${order.number} 已取消${order.cancelReason ? `（${order.cancelReason}）` : ""}${order.discount ? `，折扣碼 ${order.discount.code} 已退回` : ""}`, "order", now); break;
    }
    case "order.completeReady": {
      const ready = state.orders.filter(order => order.status === "ready");
      for (const order of ready) { order.status = "completed"; order.updatedAt = now; }
      result.completed = ready.length;
      if (!ready.length) return { state: input, result, noop: true };
      activity(state, `${ready.length} 筆可取餐訂單已全部完成`, "order", now); break;
    }
    case "menu.save": {
      const previous = payload.id ? find(state.menu, payload.id, "餐點") : null;
      const price = payload.price;
      if (typeof price !== "number" || !Number.isInteger(price) || price < 0 || price > L.menuPriceMax) throw new HttpError(`餐點價格須為 0 至 ${L.menuPriceMax} 的整數。`, 400);
      const menu: MenuItem = {
        id: previous?.id || uuid("menu"), name: text(payload.name, "餐點名稱", L.menuName), price, category: text(payload.category || "其他", "餐點分類", L.menuCategory),
        description: text(payload.description, "餐點介紹", L.menuDescription, false), image: imageUrl(payload.image),
        available: payload.available === undefined ? previous?.available ?? true : payload.available === true,
        soldOutOn: payload.soldOut === undefined ? previous?.soldOutOn ?? null : payload.soldOut === true ? taipeiDate(now) : null,
        nameEn: payload.nameEn === undefined ? previous?.nameEn ?? "" : text(payload.nameEn, "英文名稱", L.menuName, false),
        descriptionEn: payload.descriptionEn === undefined ? previous?.descriptionEn ?? "" : text(payload.descriptionEn, "英文介紹", L.menuDescription, false),
        categoryEn: payload.categoryEn === undefined ? previous?.categoryEn ?? "" : text(payload.categoryEn, "英文分類", L.menuCategory, false)
      };
      if (!previous && state.menu.length >= TRUCK_LIMITS.menu) throw new HttpError(`工作台最多可保存 ${TRUCK_LIMITS.menu} 道餐點。`, 400);
      if (previous) Object.assign(previous, menu); else state.menu.push(menu); result.menu = menu;
      activity(state, `已儲存菜單：${menu.name}`, "menu", now); break;
    }
    case "menu.soldout": {
      const item = find(state.menu, payload.id, "餐點");
      item.soldOutOn = payload.soldOut === false ? null : taipeiDate(now);
      result.menu = item; activity(state, `${item.name} ${item.soldOutOn ? "今日售完" : "恢復供應"}`, "menu", now); break;
    }
    case "menu.restock": {
      let count = 0;
      for (const item of state.menu) if (item.soldOutOn) { item.soldOutOn = null; count++; }
      result.restocked = count; activity(state, `${count} 道餐點恢復供應`, "menu", now); break;
    }
    case "menu.listing": {
      const item = find(state.menu, payload.id, "餐點");
      item.available = payload.available === true;
      result.menu = item; activity(state, `${item.name} ${item.available ? "已上架" : "已下架"}`, "menu", now); break;
    }
    case "menu.delete": {
      const item = find(state.menu, payload.id, "餐點");
      state.menu = state.menu.filter(row => row.id !== item.id);
      result.id = item.id; activity(state, `已刪除餐點：${item.name}`, "menu", now); break;
    }
    case "menu.move": {
      const item = find(state.menu, payload.id, "餐點");
      const index = state.menu.indexOf(item);
      const target = index + (payload.direction === "up" ? -1 : 1);
      if (target < 0 || target >= state.menu.length) return { state: input, result: { moved: false }, noop: true };
      state.menu.splice(index, 1); state.menu.splice(target, 0, item);
      result.moved = true; break;
    }
    case "menu.translate": {
      const rows = Array.isArray(record(extras.ai).items) ? record(extras.ai).items as unknown[] : [];
      if (!rows.length) throw new HttpError(extras.aiError || "目前無法自動翻譯，請在餐點中手動填寫英文。", 503);
      let translated = 0;
      for (const raw of rows) {
        const row = record(raw); const item = state.menu.find(entry => entry.id === row.id);
        if (!item) continue;
        const nameEn = clean(row.nameEn, L.menuName);
        if (!nameEn) continue;
        item.nameEn = nameEn; item.descriptionEn = clean(row.descriptionEn, L.menuDescription); item.categoryEn = clean(row.categoryEn, L.menuCategory); translated++;
      }
      const brand = record(record(extras.ai).brand);
      if (clean(brand.nameEn, L.brandName)) { state.brand.nameEn = clean(brand.nameEn, L.brandName); state.brand.descriptionEn = clean(brand.descriptionEn, L.brandDescription); }
      result.translated = translated; activity(state, `已翻譯 ${translated} 道餐點的英文菜單`, "menu", now); break;
    }
    case "coupon.create": {
      const coupon = couponFromOffer(state, payload, { label: clean(payload.label, L.couponLabel) || "", memberIds: null, source: "manual", campaignId: null, now, days: payload.days === undefined ? 30 : integer(payload.days, "有效天數", 0, 365), code: typeof payload.code === "string" && payload.code.trim() ? payload.code : "" });
      if (payload.maxUses !== undefined && payload.maxUses !== "" && payload.maxUses !== null) coupon.maxUses = integer(payload.maxUses, "可使用次數", 1, 100000);
      state.coupons.unshift(coupon); result.coupon = coupon;
      activity(state, `建立折扣碼 ${coupon.code}`, "coupon", now); break;
    }
    case "coupon.toggle": {
      const coupon = find(state.coupons, payload.id, "折扣碼");
      coupon.active = payload.active === true; result.coupon = coupon;
      activity(state, `折扣碼 ${coupon.code} 已${coupon.active ? "啟用" : "停用"}`, "coupon", now); break;
    }
    case "campaign.send": {
      const segment = text(payload.segment, "推播對象", 20);
      const segmentLabel = text(payload.segmentLabel, "推播對象", 20);
      const recipients = [...new Set((Array.isArray(payload.recipients) ? payload.recipients : []).filter((id): id is string => typeof id === "string"))]
        .filter(id => state.members.some(member => member.id === id && member.optIn !== false));
      if (!recipients.length) throw new HttpError("這個分群目前沒有可推播的會員。", 400);
      const kind = payload.kind === "activity" ? "activity" : payload.kind === "profile" ? "profile" : "coupon";
      const title = text(payload.title, "推播標題", L.campaignTitle);
      let message = text(payload.message, "推播內容", L.campaignMessage);
      const id = uuid("campaign");
      let coupon: Coupon | null = null;
      if (kind !== "profile") {
        coupon = couponFromOffer(state, payload.offer, { memberIds: recipients, source: "campaign", campaignId: id, now, days: payload.days === undefined ? 14 : integer(payload.days, "有效天數", 1, 365) });
        state.coupons.unshift(coupon);
        if (!message.includes(coupon.code)) message = `${message}\n折扣碼：${coupon.code}（${coupon.label}）`.slice(0, L.campaignMessage + 60);
      }
      if (state.campaigns.length >= TRUCK_LIMITS.campaigns) state.campaigns = state.campaigns.slice(0, TRUCK_LIMITS.campaigns - 1);
      const campaign: Campaign = { id, segment, segmentLabel, kind, title, message, couponId: coupon?.id ?? null, couponCode: coupon?.code ?? null, recipients, sentAt: now };
      state.campaigns.unshift(campaign); result.campaign = campaign; if (coupon) result.coupon = coupon;
      activity(state, `已推播「${title}」給 ${recipients.length} 位${segmentLabel}`, "campaign", now); break;
    }
    case "brand.update": {
      const brand = state.brand;
      if (payload.name !== undefined) brand.name = text(payload.name, "店名", L.brandName);
      if (payload.shortName !== undefined) brand.shortName = text(payload.shortName, "簡稱", 12);
      if (payload.category !== undefined) brand.category = text(payload.category, "類型", 30, false) || "行動餐車";
      if (payload.description !== undefined) brand.description = text(payload.description, "品牌介紹", L.brandDescription, false);
      if (payload.tagline !== undefined) brand.tagline = text(payload.tagline, "標語", 40, false);
      if (payload.location !== undefined) brand.location = text(payload.location, "主要地區", 60, false);
      if (payload.nameEn !== undefined) brand.nameEn = text(payload.nameEn, "英文店名", L.brandName, false);
      if (payload.descriptionEn !== undefined) brand.descriptionEn = text(payload.descriptionEn, "英文介紹", L.brandDescription, false);
      if (payload.coverImage !== undefined) brand.coverImage = imageUrl(payload.coverImage);
      if (payload.instagram !== undefined) brand.instagram = text(payload.instagram, "Instagram 網址", 300, false);
      if (payload.website !== undefined) brand.website = text(payload.website, "官網網址", 300, false);
      result.brand = brand; activity(state, "已更新品牌資料", "settings", now); break;
    }
    case "settings.update": {
      if (payload.profileReward !== undefined) state.settings.profileReward = integer(payload.profileReward, "會員資料完成禮金額", 0, 1000);
      const rfm = record(payload.rfm);
      if (rfm.loyalOrders !== undefined) state.settings.rfm.loyalOrders = integer(rfm.loyalOrders, "常來客消費次數", 2, 50);
      if (rfm.activeDays !== undefined) state.settings.rfm.activeDays = integer(rfm.activeDays, "活躍天數", 7, 180);
      if (rfm.churnDays !== undefined) state.settings.rfm.churnDays = integer(rfm.churnDays, "流失天數", 14, 365);
      if (rfm.bigOrder !== undefined) state.settings.rfm.bigOrder = integer(rfm.bigOrder, "大筆消費門檻", 1, 100000);
      if (state.settings.rfm.churnDays <= state.settings.rfm.activeDays) throw new HttpError("流失天數必須大於活躍天數。", 400);
      const ordering = record(payload.ordering);
      const orderingChanged = ordering.paused !== undefined || ordering.message !== undefined;
      if (ordering.paused !== undefined) state.settings.ordering.paused = ordering.paused === true;
      if (ordering.message !== undefined) state.settings.ordering.message = text(ordering.message, "暫停接單說明", 80, false);
      result.settings = state.settings;
      activity(state, orderingChanged && Object.keys(payload).length === 1 ? (state.settings.ordering.paused ? "已暫停線上接單" : "已恢復線上接單") : "已更新會員設定", "settings", now); break;
    }
    case "analytics.feedback": {
      // One feedback source per kind: later feedback replaces the earlier summary instead of piling up copies.
      const save = (source: TruckSource): TruckSource => {
        const previous = state.sources.find(row => row.type === "performance" && row.title === source.title && (row.mode === "meta") === (source.mode === "meta"));
        if (!previous && state.sources.length >= TRUCK_LIMITS.sources) throw new HttpError("工作台的品牌來源已達儲存上限。", 409);
        const saved = previous ? { ...previous, content: source.content, status: "ready" as const, updatedAt: now } : source;
        state.sources = [saved, ...state.sources.filter(row => row.id !== saved.id)];
        return saved;
      };
      if (payload.mode === "meta") {
        const posts = state.posts.filter(post => post.mode === "meta" && post.meta?.remoteId && post.metrics?.fetchedAt
          && [post.metrics.reach, post.metrics.likes, post.metrics.comments, post.metrics.saves, post.metrics.views, post.metrics.shares].some(value => value != null));
        if (!posts.length) throw new HttpError("請先同步有可用指標的 Meta 貼文成效。", 409);
        const dates = posts.map(post => post.publishedAt || post.createdAt).sort();
        const snapshots = posts.map(post => post.metrics!.fetchedAt!).sort();
        const content = [
          "Meta 實際貼文成效，樣本 " + posts.length + " 則。",
          "貼文發佈期間 " + dates[0] + " 至 " + dates.at(-1) + "。指標為各篇累計。",
          "讀取期間 " + snapshots[0] + " 至 " + snapshots.at(-1) + "。空值表示未取得或不適用。",
          ...posts.map(post => post.platform + " " + post.meta!.accountId + " 貼文 " + post.meta!.remoteId
            + "｜觸及 " + (post.metrics!.reach ?? "—") + "｜讚 " + (post.metrics!.likes ?? "—")
            + "｜留言 " + (post.metrics!.comments ?? "—") + "｜收藏 " + (post.metrics!.saves ?? "—")
            + "｜瀏覽 " + (post.metrics!.views ?? "—") + "｜分享 " + (post.metrics!.shares ?? "—")),
        ].join("\n");
        const source = save({ id: uuid("source"), title: "Meta 貼文成效回饋", type: "performance", content, status: "ready", createdAt: now, mode: "meta" });
        state.diagnosis.feedbackAt = now; result.source = source;
        activity(state, "已把 Meta 貼文成效加入品牌資料", "analytics", now); break;
      }
      const posts = state.posts.filter(post => post.mode !== "meta" && post.status === "published" && post.metrics);
      if (!posts.length) throw new HttpError("請先為已發布的貼文填寫成效，再回饋到資料中心。", 400);
      const totals = posts.reduce((acc, post) => ({ reach: acc.reach + (post.metrics?.reach || 0), likes: acc.likes + (post.metrics?.likes || 0), clicks: acc.clicks + (post.metrics?.clicks || 0) }), { reach: 0, likes: 0, clicks: 0 });
      const best = [...posts].sort((a, b) => Number(b.metrics?.likes || 0) - Number(a.metrics?.likes || 0))[0]!;
      const source = save({ id: uuid("source"), title: "貼文成效回饋", type: "performance", content: `已發布 ${posts.length} 則貼文，累計觸及 ${totals.reach}、按讚 ${totals.likes}、點擊 ${totals.clicks}。按讚最多的是「${best.title}」。下一篇可以試著把出車時間和預訂連結放在前兩行，看點擊會不會變多。`, status: "ready", createdAt: now });
      state.diagnosis.feedbackAt = now; result.source = source;
      activity(state, "已把貼文成效加入資料中心", "analytics", now); break;
    }
    case "workspace.reset":
    case "demo.reset": {
      const reset = extras.prepared === "blank" ? blankTruckState(input.brand.name, now) : seedTruckState(now);
      reset.revision = input.revision + 1;
      reset.posts.unshift(...input.posts.filter(post => post.mode === "meta"));
      reset.sources.unshift(...input.sources.filter(source => source.mode === "meta"));
      trimCollections(reset);
      return { state: reset, result: { reset: true } };
    }
    default: throw new HttpError("不支援的工作台操作。", 400);
  }
  trimCollections(state);
  state.revision = input.revision + 1;
  return { state, result };
}

/** Newest-first collections drop their oldest rows once they exceed the limits. */
function trimCollections(state: TruckState): void {
  if (state.orders.length > TRUCK_LIMITS.orders) state.orders = state.orders.slice(0, TRUCK_LIMITS.orders);
  if (state.members.length > TRUCK_LIMITS.members) state.members = state.members.slice(0, TRUCK_LIMITS.members);
  if (state.coupons.length > TRUCK_LIMITS.coupons) state.coupons = state.coupons.slice(0, TRUCK_LIMITS.coupons);
  if (state.campaigns.length > TRUCK_LIMITS.campaigns) state.campaigns = state.campaigns.slice(0, TRUCK_LIMITS.campaigns);
  trimTruckPosts(state);
  if (state.sources.length > TRUCK_LIMITS.sources) state.sources = state.sources.slice(0, TRUCK_LIMITS.sources);
  if (state.activity.length > TRUCK_LIMITS.activity) state.activity = state.activity.slice(0, TRUCK_LIMITS.activity);
}

export function trimTruckPosts(state: TruckState): void {
  const liveCount = state.posts.filter(post => post.mode === "meta").length;
  let demoSlots = TRUCK_LIMITS.posts - liveCount;
  if (state.posts.length > TRUCK_LIMITS.posts) state.posts = state.posts.filter(post => post.mode === "meta" || demoSlots-- > 0);
}

const LEGACY_MARKERS = /\n*〔[^〕]*(?:示範|模擬|課程)[^〕]*〕/g;
/** Fills fields added after a workspace was stored and upgrades version-1 workspaces in place. Idempotent. */
export function normalizeTruckState(state: TruckState, now = new Date().toISOString()): TruckState {
  const raw = state as Partial<TruckState> & Record<string, unknown>;
  const version = Number(record(raw.workspace).version) || 1;
  const blankBrand = blankTruckState(String(record(raw.brand).name || "我的餐車"), now).brand;
  state.brand = { ...blankBrand, ...record(raw.brand) } as TruckBrand;
  for (const key of ["sources", "posts", "stalls", "menu", "orders", "members", "coupons", "campaigns", "activity"] as const) {
    if (!Array.isArray(raw[key])) (state as unknown as Record<string, unknown>)[key] = [];
  }
  if (!Array.isArray(raw.archetypes) || !raw.archetypes.length) state.archetypes = ARCHETYPES.map(([id, label, score, description]) => ({ id, label, score, description }));
  const diagnosis = record(raw.diagnosis);
  const audienceLines = cleanList(diagnosis.audience, 5, 120);
  // Diagnoses made before the libraries keep their free-text audience lines (shown without library help) until rebuilt.
  const audiences: AudienceEntry[] = Array.isArray(diagnosis.audiences)
    ? diagnosis.audiences.map(raw => ({ label: clean(record(raw).label, 30), situation: clean(record(raw).situation, 120) })).filter(row => row.label)
    : audienceLines.map(line => ({ label: line, situation: "" }));
  const verdicts: Verdict[] = ["advantage", "similar", "weaker", "unknown"];
  state.diagnosis = {
    status: diagnosis.status === "empty" ? "empty" : "ready", generatedAt: String(diagnosis.generatedAt || now), positioning: String(diagnosis.positioning || ""),
    tone: cleanList(diagnosis.tone, 5, 20), toneNote: String(diagnosis.toneNote || "用平常講話的口氣，多寫餐點和現場的實際狀況，少喊口號。"),
    audience: audienceLines.length ? audienceLines : audienceText(audiences), audiences, differentiation: cleanList(diagnosis.differentiation, 10, 160),
    comparison: Array.isArray(diagnosis.comparison) ? diagnosis.comparison.map(raw => {
      const row = record(raw);
      return { id: clean(row.id, 40), label: clean(row.label, 30), typical: clean(row.typical, 160), store: clean(row.store, 160), verdict: verdicts.includes(row.verdict as Verdict) ? row.verdict as Verdict : "unknown", basis: row.basis === "data" || row.basis === "ai" ? row.basis : "rules" } as ComparisonRow;
    }).filter(row => row.id && row.label) : [],
    pillars: (Array.isArray(diagnosis.pillars) ? diagnosis.pillars : []).map(raw => {
      const row = record(raw); const title = clean(row.title, 30); const detail = clean(row.detail, 160); const topics = cleanList(row.topics, 3, 60);
      return { title, detail, topics: topics.length ? topics : pillarTopics(title, detail) };
    }).filter(row => row.title),
    summary: String(diagnosis.summary || ""),
    feedbackAt: typeof diagnosis.feedbackAt === "string" ? diagnosis.feedbackAt : null, engine: diagnosis.engine === "ai" ? "ai" : "rules"
  };
  for (const post of state.posts) {
    if (typeof post.cardTitle !== "string") post.cardTitle = "";
    post.caption = String(post.caption || "").replace(LEGACY_MARKERS, "").trimEnd();
  }
  for (const item of state.menu) {
    const row = item as Partial<MenuItem> & MenuItem;
    const seeded = FLAGSHIP_MENU.find(entry => entry.id === row.id);
    if (seeded && /示範|測試|課程/.test(`${row.description} ${row.category}`)) { row.description = seeded.description; row.category = seeded.category; }
    if (row.soldOutOn === undefined) row.soldOutOn = null;
    if (typeof row.nameEn !== "string") row.nameEn = "";
    if (typeof row.descriptionEn !== "string") row.descriptionEn = "";
    if (typeof row.categoryEn !== "string") row.categoryEn = "";
    if (typeof row.available !== "boolean") row.available = true;
  }
  for (const member of state.members) {
    const row = member as Partial<Member> & Member;
    if (row.demographics === undefined) row.demographics = null;
    if (row.profileAt === undefined) row.profileAt = null;
    if (row.consentAt === undefined) row.consentAt = null;
    if (typeof row.optIn !== "boolean") row.optIn = true;
  }
  for (const order of state.orders) {
    const row = order as Partial<Order> & Order;
    if (typeof row.subtotal !== "number") row.subtotal = Number(row.total || 0);
    if (row.discount === undefined) row.discount = null;
  }
  // Activity written by the first version described sample data; the product never writes these words.
  state.activity = state.activity.filter(row => !/示範|模擬|課程/.test(String(row.text || "")));
  // System-written labels of the first version.
  for (const source of state.sources) {
    if (source.title === "社群模擬成效回饋") source.title = "貼文成效回饋";
    source.content = source.content.replace(/（模擬數據）/g, "");
  }
  for (const stall of state.stalls) if (stall.notes === "示範場次，非實際出車公告") stall.notes = "";
  if (!raw.assistant) state.assistant = defaultAssistant();
  // Trends saved before the daily hot topics (no date / seasonal list) are refreshed on the next visit.
  const trends = record(raw.trends);
  if (raw.trends === undefined || (raw.trends && (typeof trends.date !== "string" || !Array.isArray(trends.seasonal) || !Array.isArray(trends.avoid)))) state.trends = null;
  const settings = record(raw.settings);
  const calendarLabels = (Array.isArray(settings.calendarLabels) ? settings.calendarLabels : []).map(record)
    .map(label => ({ id: clean(label.id, 100), name: clean(label.name, 8), color: LABEL_COLORS.includes(String(label.color)) ? String(label.color) : "blue" }))
    .filter(label => label.id && label.name).slice(0, MAX_CUSTOM_LABELS);
  const labelRules = Object.fromEntries(Object.entries(record(settings.labelRules)).filter(([, value]) => typeof value === "string" && calendarLabels.some(label => label.id === value))) as Record<string, string>;
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...settings, rfm: { ...DEFAULT_SETTINGS.rfm, ...record(settings.rfm) }, ordering: { ...DEFAULT_SETTINGS.ordering, ...record(settings.ordering) }, calendarLabels, labelRules } as TruckSettings;
  if (version < 2) {
    const seed = seedTruckState(now);
    const isFlagship = state.sources.some(source => source.id.startsWith("demo-source")) || state.menu.some(item => item.id.startsWith("demo-menu"));
    if (isFlagship) {
      // Version 1 shipped labelled sample records; replace them with the product seed and keep everything the team created.
      const merge = <T extends { id: string }>(current: T[], seeded: T[]): T[] => {
        const seededIds = new Set(seeded.map(row => row.id));
        return [...seeded, ...current.filter(row => !seededIds.has(row.id))];
      };
      state.brand = { ...seed.brand, name: state.brand.name || seed.brand.name, shortName: state.brand.shortName || seed.brand.shortName };
      state.sources = merge(state.sources, seed.sources);
      state.posts = merge(state.posts, seed.posts);
      state.stalls = merge(state.stalls, seed.stalls);
      state.menu = state.menu.map(item => {
        const seeded = seed.menu.find(row => row.id === item.id);
        return seeded ? { ...item, nameEn: item.nameEn || seeded.nameEn, descriptionEn: item.descriptionEn || seeded.descriptionEn, categoryEn: item.categoryEn || seeded.categoryEn, soldOutOn: item.available === false ? taipeiDate(now) : item.soldOutOn, available: true } : item;
      });
      state.members = merge(state.members, seed.members);
      state.orders = merge(state.orders, seed.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      state.coupons = merge(state.coupons, seed.coupons);
      state.campaigns = merge(state.campaigns, seed.campaigns);
      state.diagnosis = { ...seed.diagnosis, generatedAt: state.diagnosis.generatedAt, feedbackAt: state.diagnosis.feedbackAt };
      state.activity = state.activity.filter(row => row.id !== "demo-activity-start");
      state.workspace = { version: STATE_VERSION, createdAt: seed.workspace.createdAt };
    } else {
      state.workspace = { version: STATE_VERSION, createdAt: String(record(raw.workspace).createdAt || now) };
    }
  }
  if (!state.workspace || typeof state.workspace.createdAt !== "string") state.workspace = { version: STATE_VERSION, createdAt: now };
  // The flagship's sample diagnosis from before the libraries: show library tones and the 一般餐車 comparison without a rebuild.
  if (!state.diagnosis.comparison.length && state.diagnosis.status === "ready" && state.diagnosis.tone.join("|") === "親切|尊重夥伴|資訊清楚") {
    const seed = seedTruckState(now).diagnosis;
    const comparison = buildComparison(state, now, new Map(Object.entries(SEED_JUDGEMENTS)), "rules");
    state.diagnosis = { ...seed, comparison, differentiation: advantages(comparison), generatedAt: state.diagnosis.generatedAt, feedbackAt: state.diagnosis.feedbackAt };
  }
  trimCollections(state);
  return state;
}

// ---------------------------------------------------------------------------------------------------------------------
// Customer projection
// ---------------------------------------------------------------------------------------------------------------------
export interface PublicSubscription { order?: string | null | undefined; member?: string | null | undefined }
/** The signed-in member's own record (only ever sent to the device holding that membership). */
export interface PublicMember { id: string; name: string; phone: string; profileComplete: boolean; createdAt: string; demographics: Demographics | null; optIn: boolean }
export interface PublicOffer { code: string; label: string; kind: Coupon["kind"]; value: number; itemId: string | null; minSpend: number; expiresAt: string | null }
export interface PublicMessage { id: string; title: string; message: string; sentAt: string; code: string | null }
export interface PublicMenuItem extends MenuItem { soldOut: boolean }
/** The visitor's own order, with how many orders are still ahead of it in the kitchen. */
export interface PublicOrder extends Order { ahead: number }
export interface PublicView {
  /** `myOrders`: only the orders this page follows (never the merchant's `orders` collection). */
  brand: TruckState["brand"]; menu: PublicMenuItem[]; stalls: Stall[]; order: PublicOrder | null; myOrders: PublicOrder[]; member: PublicMember | null;
  offers: PublicOffer[]; inbox: PublicMessage[]; rewards: { profileReward: number }; ordering: OrderingSettings; revision: number;
}
/** A customer page follows up to five of its own orders (comma-separated ids). */
const MAX_TRACKED_ORDERS = 5;
export function trackedOrderIds(value: string | null | undefined): string[] {
  return [...new Set(String(value || "").split(",").map(id => id.trim()).filter(id => RECORD_ID.test(id)))].slice(0, MAX_TRACKED_ORDERS);
}
function publicOrder(state: TruckState, order: Order): PublicOrder {
  // Orders are stored newest first, so a later index breaks a same-millisecond tie as "earlier".
  const position = state.orders.indexOf(order);
  const ahead = QUEUE_STATUSES.includes(order.status)
    ? state.orders.filter((row, index) => row.id !== order.id && QUEUE_STATUSES.includes(row.status) && (row.createdAt < order.createdAt || (row.createdAt === order.createdAt && index > position))).length
    : 0;
  return { ...order, ahead };
}
function maskPhone(value: string): string { return value.length >= 7 ? `${value.slice(0, 4)}***${value.slice(-3)}` : value; }
function memberView(_state: TruckState, member: Member): PublicMember {
  return { id: member.id, name: member.name, phone: maskPhone(member.phone), profileComplete: profileComplete(member.demographics), createdAt: member.createdAt, demographics: member.demographics ? structuredClone(member.demographics) : null, optIn: member.optIn };
}
function offerView(coupon: Coupon): PublicOffer {
  return { code: coupon.code, label: coupon.label, kind: coupon.kind, value: coupon.value, itemId: coupon.itemId, minSpend: coupon.minSpend, expiresAt: coupon.expiresAt };
}
/** Customer-facing projection: menu, schedule and only the caller's own order/member — never other customers' details. */
export function publicView(state: TruckState, ids: PublicSubscription = {}, now = new Date().toISOString()): PublicView {
  const member = ids.member ? state.members.find(row => row.id === ids.member) ?? null : null;
  const today = taipeiDate(now);
  const myOrders = trackedOrderIds(ids.order).map(id => state.orders.find(row => row.id === id)).filter((row): row is Order => Boolean(row)).map(row => publicOrder(state, row));
  return {
    brand: state.brand,
    menu: state.menu.filter(item => item.available).map(item => ({ ...item, soldOut: item.soldOutOn === today })),
    stalls: state.stalls.filter(stall => stall.date >= taipeiDate(now, -1)).slice(0, 20),
    order: myOrders[0] ?? null,
    myOrders,
    ordering: state.settings.ordering,
    member: member ? memberView(state, member) : null,
    offers: member ? state.coupons.filter(coupon => coupon.active && coupon.memberIds?.includes(member.id) && !coupon.usedBy.includes(member.id) && (!coupon.expiresAt || coupon.expiresAt > now) && (coupon.maxUses === null || coupon.uses < coupon.maxUses)).map(offerView) : [],
    inbox: member ? state.campaigns.filter(campaign => campaign.recipients.includes(member.id)).slice(0, 20).map(campaign => ({ id: campaign.id, title: campaign.title, message: campaign.message, sentAt: campaign.sentAt, code: campaign.couponCode })) : [],
    rewards: { profileReward: state.settings.profileReward },
    revision: state.revision
  };
}
const RECORD_ID = /^[A-Za-z0-9-]{1,100}$/;
export function subscriptionFrom(url: URL): PublicSubscription {
  const clean = (value: string | null) => value && RECORD_ID.test(value) ? value : null;
  const orders = trackedOrderIds(url.searchParams.get("order"));
  return { order: orders.length ? orders.join(",") : null, member: clean(url.searchParams.get("member")) };
}
/** Read-only customer check of a discount code against the current menu prices. */
export function checkCoupon(state: TruckState, rawPayload: unknown, now = new Date().toISOString()): CouponCheck {
  const payload = record(rawPayload);
  const member = typeof payload.memberId === "string" ? state.members.find(row => row.id === payload.memberId) ?? null : null;
  let items: OrderItem[];
  try { items = priceItems(state, payload.items, now, false); } catch (error) { return { ok: false, code: String(payload.code || ""), amount: 0, label: "", error: error instanceof Error ? error.message : "請先選擇餐點。" }; }
  const supplied = typeof payload.phone === "string" ? payload.phone.replace(/[\s()-]/g, "") : "";
  return evaluateCoupon(state, payload.code, items, { memberId: member?.id || null, phone: member?.phone || supplied }, now);
}

// ---------------------------------------------------------------------------------------------------------------------
// D1 single-row storage (fallback without a Durable Object binding)
// ---------------------------------------------------------------------------------------------------------------------
interface WorkspaceRow { state_json: string; revision: number }
type TruckDB = Pick<D1Database, "withSession">;
export async function readTruckState(db: TruckDB, now: string): Promise<TruckState> {
  const session = db.withSession("first-primary");
  let row = await session.prepare("SELECT state_json, revision FROM truck_workspace WHERE id = 1").first<WorkspaceRow>();
  if (!row) {
    const seed = seedTruckState(now);
    await session.prepare("INSERT OR IGNORE INTO truck_workspace (id, state_json, revision, updated_at) VALUES (1, ?, ?, ?)").bind(JSON.stringify(seed), seed.revision, now).run();
    row = await session.prepare("SELECT state_json, revision FROM truck_workspace WHERE id = 1").first<WorkspaceRow>();
  }
  if (!row) throw new HttpError("工作台資料尚未準備完成，請稍後重試。", 503);
  const state = normalizeTruckState(JSON.parse(row.state_json) as TruckState, now);
  state.revision = row.revision;
  return state;
}

/** Re-read and replay a pure transition on CAS conflict; never overwrite another order. */
export async function mutateTruckState(db: TruckDB, type: string, payload: unknown, now = new Date().toISOString()): Promise<ActionResult> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await readTruckState(db, now);
    const next = applyTruckAction(before, type, payload, now);
    if (next.noop) return next;
    const saved = await db.withSession("first-primary").prepare("UPDATE truck_workspace SET state_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?")
      .bind(JSON.stringify(next.state), next.state.revision, now, before.revision).run();
    if (saved.meta.changes === 1) return next;
    // Randomised back-off spreads competing writers instead of retrying in lockstep.
    await new Promise(resolve => setTimeout(resolve, 15 + Math.random() * 40 * (attempt + 1)));
  }
  throw new HttpError("同時有其他操作正在儲存，請稍後重試。", 409);
}

/** Storage behind the HTTP contract: the Durable Object in production, the D1 row as a fallback. */
export interface TruckStore {
  read(): Promise<TruckState> | TruckState;
  mutate(type: string, payload: unknown, idempotencyKey: string | null): Promise<ActionResult> | ActionResult;
}
export function d1TruckStore(db: TruckDB): TruckStore {
  return { read: () => readTruckState(db, new Date().toISOString()), mutate: (type, payload) => mutateTruckState(db, type, payload) };
}
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * GET  /api/truck/state            full merchant state
 * GET  /api/truck/public           customer view (?order=&member=)
 * POST /api/truck/actions          any workspace action
 * POST /api/truck/public/actions   customer actions only
 * GETs accept ?since=<revision> and answer 204 when nothing changed.
 */
export async function serveTruckApi(request: Request, store: TruckStore, options: { realtimeUrl?: string | null } = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    const isPublic = path === "/api/truck/public" || path === "/api/truck/public/actions";
    if (request.method === "GET" && (path === "/api/truck/state" || path === "/api/truck/public")) {
      const state = await store.read();
      const since = url.searchParams.get("since");
      if (since !== null && Number(since) === state.revision) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      const body: Record<string, unknown> = { success: true, state: isPublic ? publicView(state, subscriptionFrom(url)) : state };
      if (options.realtimeUrl) body.realtime = options.realtimeUrl;
      return json(body);
    }
    if (request.method === "POST" && (path === "/api/truck/actions" || path === "/api/truck/public/actions")) {
      let payload: Payload;
      try { payload = record(JSON.parse(new TextDecoder().decode(await bodyBytes(request, 128 * 1024)))); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError("操作資料不是有效的 JSON。", 400); }
      const type = text(payload.type, "操作類型", 60);
      if (isPublic && !CUSTOMER_ACTIONS.has(type)) throw new HttpError("顧客頁面無法執行這項操作。", 403);
      if (READ_ONLY_ACTIONS.has(type)) return json({ success: true, result: checkCoupon(await store.read(), payload.payload) });
      const key = request.headers.get("idempotency-key");
      const outcome = await store.mutate(type, payload.payload, key && IDEMPOTENCY_KEY.test(key) ? key : null);
      if (!isPublic) return json({ success: true, state: outcome.state, result: outcome.result });
      const ids = subscriptionFrom(url);
      const orderId = record(outcome.result.order).id;
      const memberId = record(outcome.result.member).id;
      const tracked = typeof orderId === "string" ? [orderId, ...trackedOrderIds(ids.order)].join(",") : ids.order;
      const view = publicView(outcome.state, { order: tracked, member: typeof memberId === "string" ? memberId : ids.member });
      return json({ success: true, state: view, result: outcome.result });
    }
    return json({ success: false, error: "找不到工作台 API。" }, 404);
  } catch (error) {
    return errorResponse(error, path);
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function errorResponse(error: unknown, path: string): Response {
  if (error instanceof HttpError) return json({ success: false, error: error.message }, error.status);
  console.error(JSON.stringify({ event: "truck.error", path, message: error instanceof Error ? error.message : String(error) }));
  return json({ success: false, error: "工作台暫時無法儲存，請稍後重試。" }, 500);
}
export async function bodyBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new HttpError("上傳資料超過大小限制。", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HttpError("上傳資料超過大小限制。", 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  return bytes;
}
async function uploadForm(request: Request, contentType: string): Promise<FormData> {
  const limit = MAX_PHOTO + 65536;
  const declared = request.headers.get("content-length");
  try {
    if (declared !== null && Number.isFinite(Number(declared))) {
      // The runtime enforces the declared length, so the body can be parsed in place (one copy instead of two).
      if (Number(declared) > limit) throw new HttpError("上傳資料超過大小限制。", 413);
      return await request.formData();
    }
    return await new Response(await bodyBytes(request, limit), { headers: { "content-type": contentType } }).formData();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("圖片上傳格式不正確。", 400);
  }
}
async function uploadPhoto(request: Request, env: TruckEnv): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) throw new HttpError("請使用表單上傳圖片。", 400);
  const form = await uploadForm(request, contentType);
  const file = form.get("file");
  if (!file || typeof file === "string" || !file.size) throw new HttpError("請選擇圖片檔案。", 400);
  if (file.size > MAX_PHOTO) throw new HttpError("圖片大小不能超過 5 MB。", 413);
  const allowed: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = allowed[file.type];
  if (!extension) throw new HttpError("僅支援 JPEG、PNG 或 WebP 圖片。", 400);
  const photo = new Uint8Array(await file.arrayBuffer());
  const png = photo.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => photo[index] === byte);
  const jpeg = photo.length >= 3 && photo[0] === 255 && photo[1] === 216 && photo[2] === 255;
  const webp = photo.length >= 12 && new TextDecoder().decode(photo.slice(0, 4)) === "RIFF" && new TextDecoder().decode(photo.slice(8, 12)) === "WEBP";
  if (!(file.type === "image/png" && png || file.type === "image/jpeg" && jpeg || file.type === "image/webp" && webp)) throw new HttpError("圖片內容與檔案格式不符。", 400);
  if (new URL(request.url).searchParams.get("publish") === "1" && (file.type !== "image/jpeg" || !isPublicationJpeg(photo))) {
    throw new HttpError("發布版本需使用 1080 × 1080 的 JPEG。", 400);
  }
  const key = `${crypto.randomUUID()}.${extension}`;
  const createdAt = new Date().toISOString();
  if (env.BUCKET) {
    await env.BUCKET.put(`truck-media/${key}`, photo, { httpMetadata: { contentType: file.type }, customMetadata: { createdAt } });
  } else {
    const chunkCount = Math.ceil(photo.byteLength / PHOTO_CHUNK_BYTES);
    const statements = [env.DB.prepare("INSERT INTO truck_media (id, content_type, size, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)").bind(key, file.type, photo.byteLength, chunkCount, createdAt)];
    for (let index = 0; index < chunkCount; index++) {
      const body = photo.slice(index * PHOTO_CHUNK_BYTES, (index + 1) * PHOTO_CHUNK_BYTES);
      statements.push(env.DB.prepare("INSERT INTO truck_media_chunks (media_id, chunk_index, body) VALUES (?, ?, ?)").bind(key, index, body.buffer));
    }
    // D1 batches are transactional: readers never see a partial uploaded image.
    await env.DB.batch(statements);
  }
  return json({ success: true, url: `/api/truck/media/${key}` });
}

async function d1Photo(env: TruckEnv, key: string): Promise<Response> {
  const session = env.DB.withSession("first-primary");
  const media = await session.prepare("SELECT content_type, size, chunk_count, created_at FROM truck_media WHERE id = ?").bind(key)
    .first<{ content_type: string; size: number; chunk_count: number; created_at: string }>();
  if (!media) throw new HttpError("找不到圖片。", 404);
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (next >= media.chunk_count) { controller.close(); return; }
        const end = Math.min(next + PHOTO_CHUNKS_PER_QUERY, media.chunk_count);
        const rows = await session.prepare("SELECT chunk_index, body FROM truck_media_chunks WHERE media_id = ? AND chunk_index >= ? AND chunk_index < ? ORDER BY chunk_index")
          .bind(key, next, end).all<{ chunk_index: number; body: number[] | ArrayBuffer }>();
        if (rows.results.length !== end - next) throw new Error("Stored image chunk is missing.");
        for (const row of rows.results) controller.enqueue(new Uint8Array(row.body));
        next = end;
      } catch (error) { controller.error(error); }
    }
  });
  return new Response(stream, { headers: {
    "content-type": media.content_type, "content-length": String(media.size),
    "cache-control": MEDIA_CACHE, "x-content-type-options": "nosniff",
    etag: `"d1-${key}"`, "last-modified": new Date(media.created_at).toUTCString()
  } });
}

/** Reads an uploaded photo into memory (OCR input). */
export async function readTruckMedia(env: TruckEnv, url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const key = url.match(/^\/api\/truck\/media\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/)?.[1];
  if (!key) throw new HttpError("請先上傳圖片。", 400);
  if (env.BUCKET) {
    const object = await env.BUCKET.get(`truck-media/${key}`);
    if (object) return { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType || "image/jpeg" };
  }
  const response = await d1Photo(env, key);
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "image/jpeg" };
}

/** Photo upload and download stay in the stateless Worker; returns null for any other path. */
export async function handleTruckMedia(request: Request, env: TruckEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isPhoto = path === "/api/truck/photo";
  const isMedia = path.startsWith("/api/truck/media/");
  if (!isPhoto && !isMedia) return null;
  try {
    if (isPhoto && request.method === "POST") return await uploadPhoto(request, env);
    if (isMedia && request.method === "GET") {
      const key = path.slice("/api/truck/media/".length);
      if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(key)) throw new HttpError("找不到圖片。", 404);
      if (env.BUCKET) {
        const object = await env.BUCKET.get(`truck-media/${key}`, { onlyIf: request.headers });
        if (!object) throw new HttpError("找不到圖片。", 404);
        const headers = new Headers({ "cache-control": MEDIA_CACHE, "x-content-type-options": "nosniff" });
        object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag);
        if (!("body" in object)) return new Response(null, { status: 304, headers });
        return new Response(object.body, { headers });
      }
      // Keys are random and never rewritten, so a matching validator is always still current.
      const etag = `"d1-${key}"`;
      if ((request.headers.get("if-none-match") || "").split(",").some(value => value.trim().replace(/^W\//, "") === etag)) {
        return new Response(null, { status: 304, headers: { etag, "cache-control": MEDIA_CACHE } });
      }
      return await d1Photo(env, key);
    }
    return json({ success: false, error: "找不到工作台 API。" }, 404);
  } catch (error) {
    return errorResponse(error, path);
  }
}

/** D1-only fallback (no Durable Object binding): same HTTP contract, without realtime or idempotency. */
export async function handleTruckRequest(request: Request, env: TruckEnv): Promise<Response> {
  return await handleTruckMedia(request, env) ?? await serveTruckApi(request, d1TruckStore(env.DB));
}

const MEDIA_REFERENCE = /\/api\/truck\/media\/([a-f0-9-]{36}\.(?:jpg|png|webp))/g;
export function referencedMediaKeys(state: TruckState): Set<string> {
  return new Set([...JSON.stringify(state).matchAll(MEDIA_REFERENCE)].map(match => match[1] as string));
}
/**
 * Removes uploads that are over a day old and referenced by no workspace (every truck's keys are passed in).
 * Bounded per run (20 D1 images = 40 statements) to stay under the Free plan's per-invocation query limit.
 */
export async function cleanupTruckMedia(env: TruckEnv, keep: Set<string> | TruckState, now = Date.now()): Promise<number> {
  const referenced = keep instanceof Set ? keep : referencedMediaKeys(keep);
  const cutoff = new Date(now - 86400000);
  let removed = 0;
  if (env.BUCKET) {
    const listed = await env.BUCKET.list({ prefix: "truck-media/", limit: 500 });
    const stale = listed.objects.filter(object => object.uploaded < cutoff && !referenced.has(object.key.slice("truck-media/".length))).map(object => object.key);
    if (stale.length) await env.BUCKET.delete(stale);
    removed += stale.length;
  }
  try {
    const rows = await env.DB.prepare("SELECT id FROM truck_media WHERE created_at < ? ORDER BY created_at LIMIT 200").bind(cutoff.toISOString()).all<{ id: string }>();
    const stale = rows.results.map(row => row.id).filter(id => !referenced.has(id)).slice(0, 20);
    if (stale.length) {
      await env.DB.batch(stale.flatMap(id => [
        env.DB.prepare("DELETE FROM truck_media_chunks WHERE media_id = ?").bind(id),
        env.DB.prepare("DELETE FROM truck_media WHERE id = ?").bind(id)
      ]));
    }
    removed += stale.length;
  } catch (error) {
    // truck_media only exists where migration 0004 ran (D1-backed photo storage).
    if (!(error instanceof Error && /no such table/i.test(error.message))) throw error;
  }
  return removed;
}
