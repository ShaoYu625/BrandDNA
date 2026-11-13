export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export interface Env {
  DB: D1Database;
  BUCKET?: R2Bucket;
  OBJECT_STORAGE?: string;
  BROWSER?: BrowserBinding;
  /** Food-truck workspace (Durable Object). Without it the truck API falls back to the D1 row. */
  TRUCK_WORKSPACE?: DurableObjectNamespace;
  ENVIRONMENT?: string;
  TRUCK_MERCHANT_AUTH?: string;
  TRUCK_MERCHANT_KEY?: string;
  TRUCK_PUBLIC_ORIGIN?: string;
  /** Initial password of the flagship account (海海人生); only used when the account is first created. */
  TRUCK_FLAGSHIP_PASSWORD?: string;
  /** OpenAI model for the food-truck workspace (default gpt-6-luna). */
  TRUCK_AI_MODEL?: string;
  /** Monthly OpenAI spend limit per truck in USD (default 2). */
  TRUCK_AI_MONTHLY_BUDGET_USD?: string;
  /** Set to "off" to keep the truck workspace on its rule-based templates. */
  TRUCK_AI?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_GRAPH_VERSION?: string;
  META_IG_CONFIG_ID?: string;
  META_FB_CONFIG_ID?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL_SOURCE_ANALYSIS?: string;
  OPENAI_MODEL_BRAND_DNA?: string;
  OPENAI_MODEL_DIAGNOSIS?: string;
  OPENAI_MODEL_IMAGE_PROMPT?: string;
  OPENAI_MODEL_BRAND_IMAGE?: string;
  OPENAI_MODEL_CHARACTER_IMAGE?: string;
  OPENAI_MODEL_CONTENT_GENERATION?: string;
  OPENAI_MODEL_MARKETING_SUGGESTIONS?: string;
  OPENAI_MODEL_RISK_CHECK?: string;
  OPENAI_MODEL_SIMULATION?: string;
  OPENAI_MODEL_OCR?: string;
  OPENAI_MODEL_DEFAULT?: string;
  OPENAI_REASONING_DEFAULT?: string;
  OPENAI_REASONING_BRAND_DNA?: string;
  OPENAI_REASONING_RISK_CHECK?: string;
  OPENAI_VERBOSITY_DEFAULT?: string;
  OPENAI_IMAGE_DETAIL_OCR?: string;
  OPENAI_WEEKLY_BUDGET_USD?: string;
}

export interface BrowserBinding {
  quickAction?: (action: string, payload: JsonRecord) => Promise<Response>;
}

export interface AiUsage {
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  feature?: string;
  created_at: string;
}

export interface RequestState {
  requestId: string;
  startedAt: number;
  aiUsage: AiUsage[];
  plan: PlanName;
  runId: string;
}

export interface AppContext {
  env: Env;
  executionCtx: ExecutionContext;
  state: RequestState;
}

export interface DbRow {
  [key: string]: unknown;
}

export interface SourceRow extends DbRow {
  id: number;
  brand_id: number;
  source_type: string;
  input_kind: string;
  title: string | null;
  url: string | null;
  original_filename: string | null;
  raw_path: string | null;
  mime_type: string | null;
  status: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_BRAND = {
  handle: "zao_shih",
  name: "沒事早事坐",
  category: "台式早午餐",
  location: "台北市",
  description: "示範用餐飲品牌，用於 BrandDNA 分析、內容生成與風險檢查流程。"
} as const;

export const DEFAULT_PLAN = "AIR";
export const DEFAULT_RUN_ID = "anonymous-run";

export const PLAN_CONFIG = {
  FREE: {
    name: "FREE",
    price: "$0/month",
    features: { diagnosis: "partial", generation: true, brand_image: true, gatekeeper: false, simulation: false },
    quotas: { content_generation: 1, brand_image: 1 }
  },
  AIR: {
    name: "AIR",
    price: "$8/month",
    features: { diagnosis: true, generation: true, brand_image: true, gatekeeper: true, simulation: true },
    quotas: { content_generation: 35, brand_image: 35 }
  },
  PRO: {
    name: "PRO",
    price: "$15/month",
    features: { diagnosis: true, generation: true, brand_image: true, gatekeeper: true, simulation: true },
    quotas: { content_generation: null, brand_image: null }
  }
} as const;

export type PlanName = keyof typeof PLAN_CONFIG;

export const BRAND_ARCHETYPES: Record<string, { name_zh: string; name_en: string; role_name: string; description: string }> = {
  innocent: { name_zh: "天真者", name_en: "The Innocent", role_name: "天真者型品牌", description: "單純、安心、樂觀，讓顧客感到放心。" },
  explorer: { name_zh: "探險家", name_en: "The Explorer", role_name: "探險家型品牌", description: "自由、探索、嘗鮮，鼓勵顧客發現新體驗。" },
  sage: { name_zh: "智者", name_en: "The Sage", role_name: "智者型品牌", description: "專業、知識、可信，協助顧客做出明智選擇。" },
  hero: { name_zh: "英雄", name_en: "The Hero", role_name: "英雄型品牌", description: "自信、突破、行動，鼓舞顧客達成目標。" },
  outlaw: { name_zh: "叛逆者", name_en: "The Outlaw", role_name: "叛逆者型品牌", description: "顛覆、鮮明、反常規，吸引喜歡差異感的顧客。" },
  magician: { name_zh: "魔法師", name_en: "The Magician", role_name: "魔法師型品牌", description: "轉化、驚喜、想像，創造令人期待的體驗。" },
  everyman: { name_zh: "凡人", name_en: "The Everyman", role_name: "凡人型品牌", description: "親近、日常、歸屬，像熟悉的朋友一樣陪伴顧客。" },
  lover: { name_zh: "愛人", name_en: "The Lover", role_name: "愛人型品牌", description: "感性、美感、關係，強調愉悅與被珍惜的感受。" },
  jester: { name_zh: "小丑", name_en: "The Jester", role_name: "小丑型品牌", description: "幽默、玩心、輕鬆，讓互動充滿趣味。" },
  caregiver: { name_zh: "照顧者", name_en: "The Caregiver", role_name: "照顧者型品牌", description: "照顧、溫暖、支持，重視安心與貼心服務。" },
  creator: { name_zh: "創造者", name_en: "The Creator", role_name: "創造者型品牌", description: "創意、設計、表達，重視原創與風格辨識。" },
  ruler: { name_zh: "統治者", name_en: "The Ruler", role_name: "統治者型品牌", description: "秩序、品質、領導，傳達穩定、精緻與掌控感。" }
};

export class HttpError extends Error {
  readonly status: number;
  readonly extra: JsonRecord;

  constructor(message: string, status = 400, extra: JsonRecord = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function normalizePlan(value: unknown): PlanName {
  const plan = String(value || DEFAULT_PLAN).toUpperCase();
  return plan === "FREE" || plan === "AIR" || plan === "PRO" ? plan : DEFAULT_PLAN;
}

export function normalizeRunId(value: unknown): string {
  const raw = String(value || DEFAULT_RUN_ID).trim();
  const normalized = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return normalized || DEFAULT_RUN_ID;
}

export function currentWeekStart(): string {
  const date = new Date();
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export function jsonResponse(payload: JsonRecord, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

export function sanitizeFilename(value: string): string {
  const safe = value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").replace(/[^A-Za-z0-9._-]+/g, "_");
  return safe.replace(/^_+|_+$/g, "") || "file";
}

export function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || "";
}

export function sourceTypeLabel(sourceType: string): string {
  const labels: Record<string, string> = {
    instagram: "Instagram",
    facebook: "Facebook",
    website: "官網",
    google_maps: "Google 商家/地圖",
    google_reviews: "Google 評論",
    recruitment: "招募人才網站",
    compliance_rule: "品牌規範",
    internal_rule: "內部規範",
    custom: "自訂資料"
  };
  return labels[sourceType] || sourceType || "自訂資料";
}

export function clampScore(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function normalizeBrandDnaPayload(input: unknown): JsonRecord {
  const dna = { ...asRecord(input) };
  const scores = asRecord(dna.archetype_scores);
  const keys = Object.keys(BRAND_ARCHETYPES);
  for (const key of keys) {
    if (scores[key] === undefined) scores[key] = key === "everyman" ? 82 : key === "caregiver" ? 76 : 35;
    scores[key] = clampScore(scores[key], 0);
  }
  dna.archetype_scores = scores;

  const rawPrimary = asRecord(dna.brand_archetype);
  let primaryKey = String(rawPrimary.key || dna.archetype_key || "").trim();
  if (!primaryKey || !BRAND_ARCHETYPES[primaryKey]) {
    primaryKey = keys.reduce((best, key) => clampScore(scores[key]) > clampScore(scores[best]) ? key : best, "everyman");
  }
  const primaryMeta = BRAND_ARCHETYPES[primaryKey] || BRAND_ARCHETYPES.everyman!;
  const primary = {
    key: primaryKey,
    name_zh: String(rawPrimary.name_zh || primaryMeta.name_zh),
    name_en: String(rawPrimary.name_en || primaryMeta.name_en),
    role_name: String(rawPrimary.role_name || primaryMeta.role_name),
    confidence: clampScore(rawPrimary.confidence || scores[primaryKey], 80),
    rationale: String(rawPrimary.rationale || dna.summary || primaryMeta.description),
    description: String(rawPrimary.description || primaryMeta.description)
  };
  dna.brand_archetype = primary;
  dna.archetype = primary.role_name;

  const character = asRecord(dna.brand_character);
  const tone = asRecord(dna.tone_guide);
  const keywords = Array.isArray(dna.keywords) ? dna.keywords.map(String) : ["早餐", "親切", "在地"];
  dna.brand_character = {
    name: String(character.name || primary.role_name),
    archetype_key: primary.key,
    archetype: primary.role_name,
    positioning: String(character.positioning || dna.positioning || dna.summary || "在地、溫暖、穩定的早午餐品牌。"),
    traits: Array.isArray(character.traits) ? character.traits.slice(0, 8) as JsonValue : keywords.slice(0, 8),
    voice: String(character.voice || tone.voice || "自然、清楚、溫暖親切"),
    visual_personality: String(character.visual_personality || dna.visual_personality || "明亮、乾淨、帶有手作早餐溫度"),
    target_audience: String(character.target_audience || "重視便利早餐與安心感的家庭客"),
    description: String(character.description || dna.summary || primary.description),
    visual_prompt: String(character.visual_prompt || ""),
    ...(character.character_image ? { character_image: character.character_image as JsonValue } : {})
  };
  if (!dna.keywords) dna.keywords = keywords;
  if (!dna.forbidden_words) dna.forbidden_words = [];
  if (!dna.tone_guide) dna.tone_guide = { voice: "溫暖親切", sentence_style: "短句、自然、具生活感", emoji_usage: "少量自然使用", do: ["保持親切"], dont: ["避免誇大"] };
  if (!dna.audience_segments) dna.audience_segments = [{ name: "家庭客", need: "便利早餐", message_angle: "溫暖陪伴" }];
  if (!dna.content_guidelines) dna.content_guidelines = ["保持自然口吻", "避免無依據功效宣稱"];
  if (!dna.summary) dna.summary = "以在地早餐、親切服務與社群互動為核心的示範品牌。";
  return dna;
}

export function compactLogValue(value: unknown, depth = 0): JsonValue {
  if (depth > 3) return "<truncated>";
  if (typeof value === "string") return value.length <= 1200 ? value : `${value.slice(0, 1200)}...<truncated>`;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactLogValue(item, depth + 1));
  if (typeof value === "object" && value !== null) {
    const out: JsonRecord = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) out[key] = compactLogValue(item, depth + 1);
    return out;
  }
  return String(value);
}
