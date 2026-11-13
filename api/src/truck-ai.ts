import { OpenAIAdapter, type JsonSchemaFormat } from "./adapters/openai";
import { HttpError, type AppContext, type Env, type JsonRecord, type JsonValue } from "./schema";
import { AI_BASELINE_IDS, ARCHETYPE_IDS, AUDIENCE_IDS, TONE_IDS, TOPICS, isSoldOut, taipeiDate, type TrendSource, type TruckState } from "./routes/truck";
import { AUDIENCES, BASELINE, TONES } from "../../pages/static/truck/brand-libraries.mjs";

/**
 * Model choice for the food-truck workspace (OpenAI pricing, checked 2026-11-10, USD per 1M tokens):
 * gpt-6-luna $0.10 input / $0.01 cached / $0.50 output, vision capable. Every truck task is short structured
 * writing or extraction, so one economical model covers drafts, diagnosis, trends, translation and OCR.
 * A typical post draft is ~1.5K input + 400 output tokens ≈ US$0.0004.
 */
export const DEFAULT_TRUCK_MODEL = "gpt-6-luna";
const DEFAULT_MONTHLY_BUDGET_USD = 2;

const str = { type: "string" } as const;
const strList = { type: "array", items: { type: "string" } } as const;
function schema(name: string, properties: Record<string, unknown>): JsonSchemaFormat {
  return { name, schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties } as unknown as JsonRecord };
}
const POST_SCHEMA = schema("truck_post", { title: str, caption: str, cardTitle: str });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const DIAGNOSIS_SCHEMA = schema("truck_diagnosis", {
  summary: str, positioning: str,
  // Tones and audiences can only come from the libraries (brand-libraries.mjs).
  tone: { type: "array", items: { type: "string", enum: TONE_IDS } }, toneNote: str,
  audiences: { type: "array", items: object({ id: { type: "string", enum: AUDIENCE_IDS }, situation: str }) },
  comparison: { type: "array", items: object({ id: { type: "string", enum: AI_BASELINE_IDS }, store: str, verdict: { type: "string", enum: ["advantage", "similar", "unknown"] } }) },
  pillars: { type: "array", items: object({ title: str, detail: str, topics: strList }) },
  archetypes: { type: "array", items: object({ id: { type: "string", enum: ARCHETYPE_IDS }, score: { type: "integer" } }) }
});
/** This week's talked-about topics, clustered from news headlines and search spikes, each with joke hooks and a matching offer. */
const HOT_TOPICS_SCHEMA = schema("truck_hot_topics", {
  topics: { type: "array", items: object({
    name: str, summary: str, refs: strList, buzz: { type: "integer" }, riskLevel: { type: "string", enum: ["low", "medium", "high"] }, riskNote: str, hashtags: strList,
    hooks: { type: "array", items: object({ title: str, angle: str, topic: str, offerLabel: str, offerKind: { type: "string", enum: ["amount", "percent"] }, offerValue: { type: "integer" }, offerCode: str }) }
  }) }
});
const TRANSLATE_SCHEMA = schema("truck_menu_en", {
  items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "nameEn", "descriptionEn", "categoryEn"], properties: { id: str, nameEn: str, descriptionEn: str, categoryEn: str } } },
  brand: { type: "object", additionalProperties: false, required: ["nameEn", "descriptionEn"], properties: { nameEn: str, descriptionEn: str } }
});
const OCR_SCHEMA = schema("truck_ocr", { title: str, text: str });
const COPY_SCHEMA = schema("truck_campaign", { title: str, message: str });

const VOICE = "你是台灣行動餐車的社群小編與行銷顧問，使用繁體中文（台灣用語）。只根據提供的資料撰寫，不可捏造日期、價格、地點、折扣、獎項或顧客評價；資料沒有的就不要寫。語氣自然、不誇大、不使用醫療或功效宣稱。";

function brandBrief(state: TruckState, now: string): JsonRecord {
  const today = taipeiDate(now);
  return {
    today,
    brand: { name: state.brand.name, shortName: state.brand.shortName, category: state.brand.category, description: state.brand.description, tagline: state.brand.tagline },
    diagnosis: state.diagnosis.status === "ready" ? {
      positioning: state.diagnosis.positioning,
      // Each tone with its library definition and example, so drafts follow the tone instead of just naming it.
      tone: state.diagnosis.tone.map(label => { const entry = TONES.find(tone => tone.label === label); return entry ? { tone: label, howToWrite: entry.definition, example: entry.example } : { tone: label }; }),
      toneNote: state.diagnosis.toneNote, audience: state.diagnosis.audience, differentiation: state.diagnosis.differentiation, pillars: state.diagnosis.pillars.map(p => p.title)
    } : null,
    menu: state.menu.filter(item => item.available).slice(0, 20).map(item => ({ name: item.name, price: item.price, description: item.description, soldOutToday: isSoldOut(item, now) })),
    upcomingStalls: state.stalls.filter(stall => stall.date >= today).slice(0, 3).map(stall => ({ date: stall.date, start: stall.start, end: stall.end, title: stall.title, location: stall.location })),
    activeOffers: state.coupons.filter(coupon => coupon.active && !coupon.memberIds && (!coupon.expiresAt || coupon.expiresAt > now)).slice(0, 3).map(coupon => ({ code: coupon.code, label: coupon.label }))
  };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export class TruckAI {
  constructor(private readonly env: Env, private readonly sql: SqlStorage) {}

  initialize(): void {
    this.sql.exec("CREATE TABLE IF NOT EXISTS truck_ai_usage (month TEXT PRIMARY KEY, cost REAL NOT NULL, calls INTEGER NOT NULL, tokens INTEGER NOT NULL)");
  }

  get enabled(): boolean {
    const key = (this.env.OPENAI_API_KEY || "").trim();
    return Boolean(key) && !key.startsWith("your_") && this.env.TRUCK_AI !== "off";
  }
  get model(): string { return (this.env.TRUCK_AI_MODEL || "").trim() || DEFAULT_TRUCK_MODEL; }
  private get budget(): number {
    const value = Number(this.env.TRUCK_AI_MONTHLY_BUDGET_USD);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MONTHLY_BUDGET_USD;
  }
  private month(): string { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7); }
  private usage(): { cost: number; calls: number; tokens: number } {
    const row = this.sql.exec<{ cost: number; calls: number; tokens: number }>("SELECT cost, calls, tokens FROM truck_ai_usage WHERE month = ?", this.month()).toArray()[0];
    return row ?? { cost: 0, calls: 0, tokens: 0 };
  }
  status(): JsonRecord {
    const used = this.usage();
    return { enabled: this.enabled, model: this.model, month: this.month(), budgetUsd: this.budget, usedUsd: Math.round(used.cost * 10000) / 10000, calls: used.calls };
  }

  /** One structured call. Returns null when no API key is configured (the caller falls back to rules). */
  private async call(task: string, instructions: string, input: string | JsonValue, format: JsonSchemaFormat, maxOutputTokens: number): Promise<JsonRecord | null> {
    if (!this.enabled) return null;
    const ctx = {
      env: this.env, executionCtx: {} as ExecutionContext,
      state: { requestId: crypto.randomUUID().slice(0, 12), startedAt: Date.now(), aiUsage: [], plan: "PRO", runId: "truck-workspace" }
    } as AppContext;
    const adapter = new OpenAIAdapter(ctx, async () => {
      if (this.usage().cost >= this.budget) throw new HttpError("本月 AI 額度已用完，已改用內建範本。", 429);
    });
    // The Responses API takes a string or a list of input items; structured context is sent as JSON text.
    const body = typeof input === "string" || Array.isArray(input) ? input : JSON.stringify(input);
    try {
      return await adapter.generateJson(task, body, instructions, { schema: format, model: this.model, maxOutputTokens });
    } finally {
      const cost = ctx.state.aiUsage.reduce((sum, item) => sum + Number(item.cost_usd ?? 0.002), 0);
      const tokens = ctx.state.aiUsage.reduce((sum, item) => sum + item.total_tokens, 0);
      if (ctx.state.aiUsage.length) {
        this.sql.exec("INSERT INTO truck_ai_usage (month, cost, calls, tokens) VALUES (?, ?, ?, ?) ON CONFLICT(month) DO UPDATE SET cost = cost + excluded.cost, calls = calls + excluded.calls, tokens = tokens + excluded.tokens",
          this.month(), cost, ctx.state.aiUsage.length, tokens);
        console.log(JSON.stringify({ event: "truck.ai", task, model: this.model, calls: ctx.state.aiUsage.length, tokens, cost }));
      }
    }
  }

  post(state: TruckState, input: { platform: string; topic: string; topicKey: string; idleDays?: number; trend?: { title: string; summary: string; hook: { title: string; angle: string } | null; riskNote: string; coupon: { code: string; label: string; validUntil: string | null } | null } }, now: string): Promise<JsonRecord | null> {
    const pillar = TOPICS.find(entry => entry.key === input.topicKey)?.label || { pillar: "內容主軸", trend: "今日熱門話題", season: "季節與節慶" }[input.topicKey] || "一般";
    const recent = state.posts.filter(post => post.status === "published" || post.status === "scheduled").slice(0, 4).map(post => post.caption.slice(0, 200));
    // 蹭時事 posts are short and punchy; everything else keeps the regular length.
    const limit = input.trend
      ? (input.platform === "instagram" ? "150 到 300 字，節奏輕快，結尾 3 到 5 個 hashtag" : "120 到 250 字，節奏輕快，可不放 hashtag")
      : input.platform === "instagram" ? "300 到 600 字，結尾 3 到 5 個 hashtag" : "200 到 450 字，可不放 hashtag";
    return this.call("truck_post", `${VOICE}
任務：為這台餐車寫一則 ${input.platform === "instagram" ? "Instagram" : "Facebook"} 貼文草稿。
- 語氣照 diagnosis.tone 每個語氣的 howToWrite 寫，可以參考 example 的感覺，但不要照抄。
- caption：${limit}，開頭一句吸睛但不浮誇；有出攤資料且主題相關時寫清楚日期、時間、地點；提醒可以線上點餐、到餐車取餐。
- 不要重複最近貼文的開頭與句子。${input.trend ? `
- 這篇是蹭時事（trend）：開頭就用 trend.hook.title 這個梗，照 trend.hook.angle 寫，可以大膽、自嘲、好笑，再帶到本店餐點。只能用 trend.summary 的事件資訊，不要補充或猜測細節、人物發言或數字；可以拿自己開玩笑，不可以嘲笑真實人物的外貌、健康或不幸；不要給投資建議；不要說成名人或品牌代言。這些界線你自己避開就好，文案裡不要寫「不聊投資」「不猜行情」這類免責句。${input.trend.coupon ? "文中一定要寫出折扣碼 trend.coupon.code、優惠內容，以及「trend.coupon.validUntil 前有效」，提醒結帳時輸入。" : ""}` : ""}
- title：20 字內的貼文名稱，給店家辨識用。
- cardTitle：疊在照片上的短字卡，12 字內；不適合就回傳空字串。`,
    { ...brandBrief(state, now), platform: input.platform, topic: input.topic, contentPillar: pillar, recentPosts: recent, ...(input.trend ? { trend: input.trend } : {}) }, POST_SCHEMA, 900);
  }

  diagnosis(state: TruckState): Promise<JsonRecord | null> {
    let budget = 12000;
    const sources = state.sources.filter(source => source.content.trim()).map(source => {
      const content = source.content.slice(0, Math.max(0, Math.min(3000, budget)));
      budget -= content.length;
      return { title: source.title, type: source.type, content };
    }).filter(source => source.content);
    const imported = state.posts.filter(post => post.meta?.imported).slice(0, 10).map(post => post.caption.slice(0, 400));
    const performance = state.posts.filter(post => post.status === "published" && post.metrics).slice(0, 10).map(post => ({ title: post.title, topic: post.topic, likes: post.metrics?.likes ?? null, comments: post.metrics?.comments ?? null, saves: post.metrics?.saves ?? null, reach: post.metrics?.reach ?? null }));
    return this.call("truck_diagnosis", `${VOICE}
任務：根據品牌資料整理 Brand DNA，五個面向都要具體、可以直接拿來寫貼文。
- positioning：一句話品牌定位（60 字內）。
- tone：從 toneLibrary 挑 3 到 5 個最符合資料的語氣，回傳 id；toneNote：一句這台餐車專屬的寫作提醒。
- audiences：從 audienceLibrary 挑 3 個核心客群，回傳 id；situation 寫這台餐車的這群人在什麼情境下會買（40 字內，要具體到時間、地點或需求）。
- comparison：baseline 是團隊整理的「一般餐車」情況。針對 baseline 每一項寫 store：本店的實際情況（50 字內，只能根據資料，不可捏造）；verdict：資料明確顯示優於一般餐車才給 advantage，差不多給 similar，資料沒提到給 unknown。
- pillars：3 到 4 個內容主軸，title 6 字內、detail 說明要發什麼；topics 給 2 到 3 個可以直接拿來發文的貼文主題（每個 30 字內，要具體）。
- archetypes：12 種品牌人格各給 0 到 100 分（caregiver 照顧者、everyman 凡人、explorer 探險家、creator 創造者、innocent 天真者、hero 英雄、jester 小丑、lover 愛人、sage 智者、magician 魔法師、ruler 統治者、outlaw 叛逆者）。
- summary：120 字內，說明主要人格與依據。`,
    {
      brand: { name: state.brand.name, category: state.brand.category, description: state.brand.description },
      menu: state.menu.slice(0, 20).map(item => ({ name: item.name, price: item.price })), sources, importedPosts: imported, postPerformance: performance,
      toneLibrary: TONES.map(tone => ({ id: tone.id, label: tone.label, definition: tone.definition })),
      audienceLibrary: AUDIENCES.map(audience => ({ id: audience.id, label: audience.label, definition: audience.definition })),
      baseline: BASELINE.filter(row => row.method === "ai").map(row => ({ id: row.id, label: row.label, typical: row.typical }))
    }, DIAGNOSIS_SCHEMA, 2600);
  }

  /**
   * 時事行銷: cluster the headlines and search spikes into this week's topics (any field), then write bold joke hooks
   * with a matching offer for the topics a food truck can play with. The sources come from the feeds, never from the model.
   */
  hotTopics(state: TruckState, signals: TrendSignals, now: string): Promise<JsonRecord | null> {
    const prices = state.menu.filter(item => item.available).map(item => item.price);
    return this.call("truck_hot_topics", `你是台灣行動餐車的社群小編，擅長「蹭時事」：用大家這幾天都在聊的話題，想出讓人笑出來、又能帶到優惠的貼文梗。使用繁體中文（台灣用語）。
任務：headlines（新聞頭條，h 開頭）與 searches（搜尋暴增字，s 開頭）是台灣這幾天的熱門訊號，不限領域。
1. 把講同一件事的訊號歸成一個話題（例如多則新聞都在講黃仁勳與輝達 → 話題「黃仁勳／輝達」），找出 5 到 7 個討論度最高的話題。
   - name：話題名稱 12 字內；summary：50 字內，只能根據標題說明發生什麼事，不要補充或猜測細節；refs：支持這個話題的訊號 id（例如 ["h3","h12","s2"]），至少 1 個。
   - buzz：1 到 5，越多則新聞或搜尋在講、越多人會懂這個梗就越高。
2. 判斷風險：riskLevel low（輕鬆、正面）、medium（涉及特定人物、公司、股價或商標，或時效很短）、high（災難、傷亡、犯罪、疾病、選舉與政治人物、軍事與兩岸衝突、個人隱私）。riskNote：80 字內，老闆發文前要注意的具體風險；high 要寫「不建議搭這個話題」與原因。
3. low 與 medium 的話題各想 3 個 hooks（high 回傳空陣列）。要像朋友在 LINE 群組丟的那種好笑，大膽玩梗，不要寫成新聞評論：
   - 至少一個「自嘲」：拿老闆、餐車或自己的荷包、減肥、運氣開玩笑（例如股價大跌 →「買輝達賠錢，只好來吃一盤炒麵療傷」）。
   - 至少一個「話題直接變優惠」的反差梗（例如「輝達打折，我們也打折」「股價漲停，份量也漲停」），讓優惠本身就是笑點。
   - 其他可以用諧音、誇飾、反差。梗要跟事件的真實走向一致（新聞說漲就別寫跌）。
   - title：梗本身，20 字內，要好笑、一看就懂；angle：60 字內，這篇貼文怎麼鋪陳、怎麼帶到本店的哪道餐點；不要在 angle 裡寫免責或「不聊股票」這類說明；topic：30 字內，給系統產生貼文用的主題。
   - 每個梗配一個跟梗呼應的時事優惠：offerLabel 30 字內（例如「輝達跌、炒麵也跌：結帳折 NT$20」）；offerKind amount（折抵金額，offerValue 為 5 到 50 元，參考菜單價格 ${prices.length ? `NT$${Math.min(...prices)}–${Math.max(...prices)}` : "NT$80–150"}）或 percent（全單打折，offerValue 為折扣百分比 5 到 30，例如 9 折填 10）；offerCode：4 到 10 個大寫英文或數字，跟梗有關（例如 NVDA20）。
   - 界線（你自己避開就好，不要寫進梗或說明裡）：可以拿自己開玩笑；不可以嘲笑真實人物的外貌、健康、家庭或不幸；不可以給投資建議或預測股價；不可以使用他人的商標圖片或冒充官方。
4. hashtags：2 到 3 個，不含 # 符號；high 回傳空陣列。`,
    { ...brandBrief(state, now), headlines: signals.headlines.map(item => ({ id: item.id, title: item.title, source: item.source })), searches: signals.searches.map(item => ({ id: item.id, title: item.title, traffic: item.traffic, news: item.sources.map(source => source.title) })) }, HOT_TOPICS_SCHEMA, 3200);
  }

  translate(state: TruckState): Promise<JsonRecord | null> {
    const items = state.menu.slice(0, 40).map(item => ({ id: item.id, name: item.name, description: item.description, category: item.category }));
    if (!items.length) throw new HttpError("菜單還沒有餐點，先新增餐點再翻譯。", 400);
    return this.call("truck_menu_en", `你是餐飲菜單英文翻譯。把台灣餐車的菜單翻成自然、外國旅客看得懂的英文菜單用語。
- 保留每個 id；nameEn 簡潔（6 個英文字內）；descriptionEn 一句話；categoryEn 1 到 3 個英文字。
- 不要加入原文沒有的食材或描述。brand 欄位翻譯店名與品牌介紹（介紹 40 字內）。`,
    { brand: { name: state.brand.name, description: state.brand.description }, items }, TRANSLATE_SCHEMA, 1600);
  }

  async ocr(image: { bytes: Uint8Array; contentType: string }, hint: string): Promise<JsonRecord | null> {
    if (!this.enabled) throw new HttpError("圖片文字辨識需要啟用 AI（設定 OPENAI_API_KEY）。", 503);
    const input: JsonValue = [{ role: "user", content: [
      { type: "input_text", text: `請辨識圖片中的文字（菜單、海報、看板或社群截圖），完整、依閱讀順序轉成繁體中文純文字；價格保留數字。title 用 20 字內描述這張圖。${hint ? `店家補充：${hint}` : ""}` },
      { type: "input_image", image_url: `data:${image.contentType};base64,${base64(image.bytes)}`, detail: "high" }
    ] }];
    return this.call("truck_ocr", "你負責把圖片內容轉成文字，只輸出看得到的內容，看不清楚的地方標示「（無法辨識）」。", input, OCR_SCHEMA, 2000);
  }

  copy(state: TruckState, input: JsonRecord, now: string): Promise<JsonRecord | null> {
    return this.call("truck_campaign", `${VOICE}
任務：為會員推播寫一則簡短訊息。title 16 字內；message 80 到 140 字，親切、直接說明優惠內容、使用方式與期限；如果有折扣碼，文中保留「{折扣碼}」這個佔位字，不要自己編碼。`,
    { ...brandBrief(state, now), segment: input.segmentLabel ?? null, offer: input.offerLabel ?? null, days: input.days ?? null, kind: input.kind ?? null }, COPY_SCHEMA, 500);
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// Today's hot topics: Google Trends daily searches for Taiwan (public RSS, no key). Fetched by the Worker, never the browser.
// ---------------------------------------------------------------------------------------------------------------------
export const TRENDS_FEED = "https://trends.google.com/trending/rss?geo=TW";
export interface HotTopic { rank: number; title: string; traffic: string; news: string[]; sources: TrendSource[] }
function decodeEntities(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&amp;/g, "&").trim();
}
/** "2,000+" / "5K+" / "1萬+" → a number for ranking. */
function trafficValue(value: string): number {
  const match = /([\d.,]+)\s*([KkMm萬]?)/.exec(value);
  if (!match) return 0;
  const number = Number(match[1]!.replace(/,/g, ""));
  return number * ({ k: 1e3, m: 1e6, 萬: 1e4 }[match[2]!.toLowerCase() as "k" | "m" | "萬"] ?? 1);
}
/** Top topics of the feed by search volume (feed order breaks ties), each with up to three news links. */
export function parseTrendsFeed(xml: string, limit = 3): HotTopic[] {
  const tag = (block: string, name: string) => decodeEntities(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? "");
  const topics = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match, order) => {
    const block = match[1]!;
    const title = tag(block, "title");
    const sources = [...block.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)]
      .map(news => ({ title: tag(news[1]!, "ht:news_item_title"), url: tag(news[1]!, "ht:news_item_url"), source: tag(news[1]!, "ht:news_item_source") }))
      .filter(news => /^https?:\/\//i.test(news.url) && news.title).slice(0, 3);
    // Every hot topic needs a reference link; without news items, point at a Google News search for it.
    if (!sources.length && title) sources.push({ title: `Google 新聞：${title}`, url: `https://news.google.com/search?q=${encodeURIComponent(title)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`, source: "Google 新聞" });
    return { order, title, traffic: tag(block, "ht:approx_traffic"), sources };
  }).filter(topic => topic.title);
  return topics.sort((a, b) => trafficValue(b.traffic) - trafficValue(a.traffic) || a.order - b.order).slice(0, limit)
    .map((topic, index) => ({ rank: index + 1, title: topic.title, traffic: topic.traffic, news: topic.sources.map(source => source.title), sources: topic.sources }));
}
/** One news headline from Google News (Taiwan top stories). */
export interface Headline { id: string; title: string; source: string; url: string }
/** Search spikes and headlines the hot-topic step works from (ids h1… / s1… are what the model cites in `refs`). */
export interface TrendSignals { headlines: Headline[]; searches: (HotTopic & { id: string })[] }
export const NEWS_FEED = "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
/** Headlines of the Google News top-stories feed; the trailing「 - 媒體」 becomes the source. */
export function parseNewsFeed(xml: string, limit = 40): Headline[] {
  const tag = (block: string, name: string) => decodeEntities(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? "");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
    const block = match[1]!;
    const source = tag(block, "source");
    const raw = tag(block, "title");
    const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw.replace(/\s+-\s+[^-]{1,30}$/, "");
    return { title: title.trim(), source, url: tag(block, "link") };
  }).filter(item => item.title && /^https?:\/\//i.test(item.url)).slice(0, limit).map((item, index) => ({ id: `h${index + 1}`, ...item }));
}
async function fetchFeed(url: string, label: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; BrandDNA-Truck/1.0)", accept: "application/rss+xml,text/xml;q=0.9,*/*;q=0.5", "accept-language": "zh-TW,zh;q=0.9" }, signal: AbortSignal.timeout(8000) });
  } catch { throw new HttpError(`連不上${label}，請稍後再按「更新」。`, 502); }
  if (!response.ok) throw new HttpError(`${label}回應 ${response.status}，請稍後再試。`, 502);
  return (await response.text()).slice(0, 600000);
}
/** News headlines + search spikes. Either feed alone is enough; both failing is an error. */
export async function fetchTrendSignals(): Promise<TrendSignals> {
  const [news, searches] = await Promise.allSettled([fetchFeed(NEWS_FEED, " Google 新聞"), fetchFeed(TRENDS_FEED, " Google 搜尋趨勢")]);
  const signals: TrendSignals = {
    headlines: news.status === "fulfilled" ? parseNewsFeed(news.value) : [],
    searches: searches.status === "fulfilled" ? parseTrendsFeed(searches.value, 10).map((topic, index) => ({ ...topic, id: `s${index + 1}` })) : []
  };
  if (!signals.headlines.length && !signals.searches.length) {
    const failed = [news, searches].find(result => result.status === "rejected") as PromiseRejectedResult | undefined;
    throw failed?.reason instanceof HttpError ? failed.reason : new HttpError("今天的熱門話題暫時抓不到，稍後再按「更新」。", 502);
  }
  return signals;
}