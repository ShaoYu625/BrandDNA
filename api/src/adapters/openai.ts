import { AppContext, AiUsage, HttpError, JsonRecord, JsonValue, asRecord, parseJson, utcNow } from "../schema";

/**
 * Cost-first model choice (OpenAI pricing page, 2026-11-06, USD per 1M tokens):
 * - gpt-6-luna      $0.10 in / $0.01 cached / $0.50 out — official replacement for gpt-4o-mini; vision capable.
 * - gpt-6.1-terra   $1.00 in / $0.05 cached / $5.00 out — Brand DNA synthesis and risk review, where judgement matters.
 * - gpt-image-2.5-flare — replacement for gpt-image-1 (shut down 2026-10-23); always requested at low quality.
 * gpt-4o / gpt-4o-mini shut down 2027-01-14; gpt-5-mini/nano 2026-12-11; gpt-image-1-mini/1.5 2026-12-01.
 */
const DEFAULT_MODELS: Record<string, string> = {
  source_analysis: "gpt-6-luna",
  brand_dna: "gpt-6.1-terra",
  diagnosis: "gpt-6-luna",
  image_prompt: "gpt-6-luna",
  brand_image: "gpt-image-2.5-flare",
  character_image: "gpt-image-2.5-flare",
  content_generation: "gpt-6-luna",
  marketing_suggestions: "gpt-6-luna",
  risk_check: "gpt-6.1-terra",
  simulation: "gpt-6-luna",
  ocr: "gpt-6-luna",
  default: "gpt-6-luna"
};

const TASK_ENV: Record<string, string> = {
  source_analysis: "OPENAI_MODEL_SOURCE_ANALYSIS",
  brand_dna: "OPENAI_MODEL_BRAND_DNA",
  diagnosis: "OPENAI_MODEL_DIAGNOSIS",
  image_prompt: "OPENAI_MODEL_IMAGE_PROMPT",
  brand_image: "OPENAI_MODEL_BRAND_IMAGE",
  character_image: "OPENAI_MODEL_CHARACTER_IMAGE",
  content_generation: "OPENAI_MODEL_CONTENT_GENERATION",
  marketing_suggestions: "OPENAI_MODEL_MARKETING_SUGGESTIONS",
  risk_check: "OPENAI_MODEL_RISK_CHECK",
  simulation: "OPENAI_MODEL_SIMULATION",
  ocr: "OPENAI_MODEL_OCR",
  default: "OPENAI_MODEL_DEFAULT"
};

/** Output is 5x the price of input: cap each task near what it really needs (doubled once if a reply is cut off). */
const TASK_MAX_OUTPUT: Record<string, number> = {
  source_analysis: 3000,
  brand_dna: 5000,
  diagnosis: 4000,
  image_prompt: 1500,
  content_generation: 2500,
  marketing_suggestions: 900,
  risk_check: 2500,
  simulation: 2000,
  ocr: 2000,
  default: 2500
};

/** USD per 1M tokens, matched by model-name prefix (dated snapshots resolve to their family). */
const TEXT_PRICES: [RegExp, { input: number; cached: number; output: number }][] = [
  [/^gpt-6-luna/, { input: 0.1, cached: 0.01, output: 0.5 }],
  [/^gpt-6\.1-terra/, { input: 1, cached: 0.05, output: 5 }],
  [/^gpt-6\.1-sol/, { input: 2, cached: 0.1, output: 10 }],
  [/^gpt-6-sol/, { input: 2, cached: 0.2, output: 10 }],
  [/^gpt-6-astra/, { input: 10, cached: 1, output: 50 }],
  [/^gpt-5\.6-luna/, { input: 0.2, cached: 0.02, output: 1.2 }],
  [/^gpt-5\.6-terra/, { input: 2, cached: 0.2, output: 12 }],
  [/^gpt-4o-mini/, { input: 0.15, cached: 0.075, output: 0.6 }],
  [/^gpt-4o/, { input: 2.5, cached: 1.25, output: 10 }]
];
/** Image models: text prompt tokens in, image tokens out. */
const IMAGE_PRICES: [RegExp, { input: number; output: number }][] = [
  [/^gpt-image-2(\.5)?/, { input: 5, output: 30 }],
  [/^gpt-image-1-mini/, { input: 2, output: 8 }],
  [/^gpt-image-1\.5/, { input: 5, output: 32 }]
];

const TEXT_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 120_000;
const REASONING_LADDER = ["none", "minimal", "low"];

/**
 * Parameters a model rejected, remembered for the life of the isolate: after the first 400 the
 * parameter is never sent again, so a mismatch costs at most one extra request instead of one per call.
 */
const LEARNED_UNSUPPORTED = new Map<string, Set<string>>();
const LEARNED_EFFORT_STEP = new Map<string, number>();

const BASE_PROMPT_CONTRACT = `
<instruction_priority>
- Follow the task-specific instructions and output schema exactly.
- Safety, privacy, and factual accuracy take priority over style.
- Base conclusions only on supplied source text, Brand DNA data, or explicit user inputs.
- Do not invent URLs, customer quotes, legal requirements, metrics, menu items, or source facts.
</instruction_priority>
`.trim();

export interface JsonSchemaFormat { name: string; schema: JsonRecord }
type OutputFormat = "text" | "json" | JsonSchemaFormat;
interface ResponseOptions { temperature?: number; maxOutputTokens?: number; model?: string }

export class OpenAIAdapter {
  readonly ctx: AppContext;
  private readonly guard: (() => Promise<void>) | undefined;

  /** guard runs before every billable call (the weekly budget check). */
  constructor(ctx: AppContext, guard?: () => Promise<void>) {
    this.ctx = ctx;
    this.guard = guard;
  }

  modelFor(task: string): string {
    const envKey = TASK_ENV[task] || TASK_ENV.default;
    const configured = envKey ? this.ctx.env[envKey as keyof typeof this.ctx.env] : undefined;
    return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_MODELS[task] || DEFAULT_MODELS.default || "gpt-6-luna";
  }

  async generateJson(task: string, prompt: string | JsonValue, systemInstruction: string, options: ResponseOptions & { schema?: JsonSchemaFormat } = {}): Promise<JsonRecord> {
    const response = await this.createResponse(task, prompt, systemInstruction, options.schema || "json", options);
    return parseJsonFromModel(outputText(response));
  }

  async generateText(task: string, input: JsonValue, systemInstruction: string, options: ResponseOptions = {}): Promise<string> {
    const response = await this.createResponse(task, input, systemInstruction, "text", options);
    return outputText(response);
  }

  async generateImage(task: "brand_image" | "character_image", prompt: string, options: { size: string; quality?: string }): Promise<{ bytes: ArrayBuffer; contentType: string; model: string }> {
    await this.guard?.();
    const model = this.modelFor(task);
    const learned = LEARNED_UNSUPPORTED.get(model) ?? new Set<string>();
    const size = ["1024x1024", "1024x1536", "1536x1024"].includes(options.size) ? options.size : "1024x1024";
    const payload: JsonRecord = { model, prompt, size, n: 1, output_format: "webp", output_compression: 80 };
    // gpt-image models always return base64 and reject response_format; only DALL·E needs it.
    if (/^dall-e/i.test(model)) payload.response_format = "b64_json";
    if (!learned.has("quality")) payload.quality = "low";
    // Fail clearly instead of dropping low quality and accidentally using a more expensive default.
    const { response, json } = await this.post("https://api.openai.com/v1/images/generations", payload, IMAGE_TIMEOUT_MS);
    if (!response.ok) throw new HttpError(userSafeOpenAIError(json, response.status), response.status >= 500 ? 502 : 400);
    this.recordUsage(json, model, task, prompt, "image");
    const first = asRecord((Array.isArray(json.data) ? json.data : [])[0]);
    const b64 = typeof first.b64_json === "string" ? first.b64_json : "";
    if (b64) return { bytes: base64ToArrayBuffer(b64), contentType: "image/webp", model };
    const url = typeof first.url === "string" ? first.url : "";
    if (!url) throw new HttpError("圖片生成沒有回傳可儲存的圖片資料。", 502);
    const imageResponse = await fetch(url, { signal: AbortSignal.timeout(TEXT_TIMEOUT_MS) });
    if (!imageResponse.ok) throw new HttpError("圖片生成完成，但下載圖片失敗。", 502);
    return { bytes: await imageResponse.arrayBuffer(), contentType: imageResponse.headers.get("content-type") || "image/png", model };
  }

  private async createResponse(task: string, input: string | JsonValue, systemInstruction: string, format: OutputFormat, options: ResponseOptions): Promise<JsonRecord> {
    await this.guard?.();
    const model = options.model || this.modelFor(task);
    let maxOutputTokens = options.maxOutputTokens || TASK_MAX_OUTPUT[task] || TASK_MAX_OUTPUT.default || 2500;
    let truncatedRetry = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const payload = this.buildPayload(task, model, input, systemInstruction, format, options, maxOutputTokens);
      const { response, json } = await this.post("https://api.openai.com/v1/responses", payload, TEXT_TIMEOUT_MS);
      if (response.ok) {
        this.recordUsage(json, model, task, input, "text");
        const cutOff = json.status === "incomplete" && asRecord(json.incomplete_details).reason === "max_output_tokens";
        if (cutOff && !truncatedRetry) { truncatedRetry = true; maxOutputTokens *= 2; continue; }
        return json;
      }
      if (attempt < 2 && this.learnFromError(model, json, ["temperature", "verbosity", "prompt_cache_key", "json_schema", "reasoning"])) continue;
      throw new HttpError(userSafeOpenAIError(json, response.status), response.status >= 500 ? 502 : 400);
    }
    throw new HttpError("OpenAI 回應未完成，請稍後再試。", 502);
  }

  private buildPayload(task: string, model: string, input: string | JsonValue, systemInstruction: string, format: OutputFormat, options: ResponseOptions, maxOutputTokens: number): JsonRecord {
    const learned = LEARNED_UNSUPPORTED.get(model) ?? new Set<string>();
    const reasoningModel = isReasoningModel(model);
    const text: JsonRecord = {
      format: typeof format === "object" && !learned.has("json_schema")
        ? { type: "json_schema", name: format.name, schema: format.schema, strict: true }
        : { type: format === "text" ? "text" : "json_object" }
    };
    if (reasoningModel && !learned.has("verbosity")) text.verbosity = verbosityFor(this.ctx);
    const payload: JsonRecord = {
      model,
      // Static instructions first and the per-task prefix stable, so repeated calls hit the prompt cache.
      instructions: [BASE_PROMPT_CONTRACT, systemInstruction].filter(Boolean).join("\n\n"),
      input: input as JsonValue,
      text,
      max_output_tokens: maxOutputTokens,
      store: false
    };
    if (!learned.has("prompt_cache_key")) payload.prompt_cache_key = `branddna-${task}`;
    if (reasoningModel && !learned.has("reasoning")) payload.reasoning = { effort: reasoningEffort(this.ctx, task, model) };
    // Reasoning models only accept their default temperature; sending one would just cost a failed request.
    if (!reasoningModel && typeof options.temperature === "number" && !learned.has("temperature")) payload.temperature = options.temperature;
    return payload;
  }

  /** Returns true when the error named a parameter we can drop (or a reasoning effort we can step up). */
  private learnFromError(model: string, json: JsonRecord, candidates: string[]): boolean {
    const message = String(asRecord(json.error).message || "").toLowerCase();
    const param = String(asRecord(json.error).param || "").toLowerCase();
    const haystack = `${message} ${param}`;
    if (!/unsupported|not supported|unknown|unrecognized|invalid|does not support/.test(haystack)) return false;
    const learned = LEARNED_UNSUPPORTED.get(model) ?? new Set<string>();
    let changed = false;
    for (const name of candidates) {
      if (learned.has(name)) continue;
      const mentioned = name === "json_schema" ? /json_schema|text\.format|strict/.test(haystack) : haystack.includes(name);
      if (!mentioned) continue;
      if (name === "reasoning") {
        const step = LEARNED_EFFORT_STEP.get(model) ?? 0;
        if (step + 1 < REASONING_LADDER.length && /effort|none|minimal/.test(haystack)) { LEARNED_EFFORT_STEP.set(model, step + 1); changed = true; continue; }
      }
      learned.add(name);
      changed = true;
    }
    LEARNED_UNSUPPORTED.set(model, learned);
    return changed;
  }

  private async post(url: string, payload: JsonRecord, timeoutMs: number): Promise<{ response: Response; json: JsonRecord }> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey()}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new HttpError("OpenAI 回應逾時，請稍後再試。", 504);
      throw new HttpError("無法連線到 OpenAI，請稍後再試。", 502);
    }
    const json = (await response.json().catch(() => ({}))) as JsonRecord;
    return { response, json };
  }

  private apiKey(): string {
    const key = (this.ctx.env.OPENAI_API_KEY || "").trim();
    if (!key || key.startsWith("your_") || key === "your_openai_api_key") {
      throw new HttpError("OPENAI_API_KEY 尚未設定。請用 Cloudflare secret 設定後再重試。", 500);
    }
    return key;
  }

  private recordUsage(response: JsonRecord, model: string, feature: string, input: unknown, kind: "text" | "image"): void {
    const usage = asRecord(response.usage);
    const inputTokens = numberFrom(usage.input_tokens) || estimateTokens(input);
    const cached = numberFrom(asRecord(usage.input_tokens_details).cached_tokens);
    const outputTokens = numberFrom(usage.output_tokens) || (kind === "text" ? estimateTokens(outputText(response)) : 0);
    const reasoningTokens = numberFrom(asRecord(usage.output_tokens_details).reasoning_tokens);
    const total = numberFrom(usage.total_tokens) || inputTokens + outputTokens;
    const billedModel = String(response.model || model);
    const event: AiUsage = {
      model: billedModel,
      input_tokens: inputTokens,
      cached_input_tokens: cached,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: total,
      cost_usd: estimateCostUsd(billedModel, kind, inputTokens, cached, outputTokens),
      feature,
      created_at: utcNow()
    };
    this.ctx.state.aiUsage.push(event);
  }
}

/** Exported for tests: USD cost of one call, or null for a model without a known price. */
export function estimateCostUsd(model: string, kind: "text" | "image", inputTokens: number, cachedTokens: number, outputTokens: number): number | null {
  const name = normalizeModelName(model);
  if (kind === "image") {
    const price = IMAGE_PRICES.find(([pattern]) => pattern.test(name))?.[1];
    return price ? round6((inputTokens * price.input + outputTokens * price.output) / 1e6) : null;
  }
  const price = TEXT_PRICES.find(([pattern]) => pattern.test(name))?.[1];
  if (!price) return null;
  const fresh = Math.max(0, inputTokens - cachedTokens);
  return round6((fresh * price.input + cachedTokens * price.cached + outputTokens * price.output) / 1e6);
}

function round6(value: number): number { return Math.round(value * 1e6) / 1e6; }

function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)(?:[.-]|$)/.test(normalizeModelName(model));
}

/** OPENAI_REASONING_* = none/off → the lowest effort the model accepts (never the model's own, pricier default). */
function reasoningEffort(ctx: AppContext, task: string, model: string): string {
  const configured = task === "brand_dna"
    ? ctx.env.OPENAI_REASONING_BRAND_DNA
    : task === "risk_check"
      ? ctx.env.OPENAI_REASONING_RISK_CHECK
      : ctx.env.OPENAI_REASONING_DEFAULT;
  const normalized = String(configured || "none").trim().toLowerCase();
  if (["low", "medium", "high"].includes(normalized)) return normalized;
  return REASONING_LADDER[LEARNED_EFFORT_STEP.get(model) ?? 0] || "low";
}

function verbosityFor(ctx: AppContext): string {
  const normalized = String(ctx.env.OPENAI_VERBOSITY_DEFAULT || "medium").trim().toLowerCase();
  return ["low", "medium", "high"].includes(normalized) ? normalized : "medium";
}

function normalizeModelName(model: string): string {
  return String(model || "").trim().toLowerCase();
}

function outputText(response: JsonRecord): string {
  if (typeof response.output_text === "string") return response.output_text.trim();
  const chunks: string[] = [];
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    const out = asRecord(item);
    const content = Array.isArray(out.content) ? out.content : [];
    for (const contentItem of content) {
      const record = asRecord(contentItem);
      if (typeof record.text === "string") chunks.push(record.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonFromModel(text: string): JsonRecord {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = parseJson<unknown>(cleaned, null);
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonRecord;
  const start = Math.min(...["{", "["].map((token) => cleaned.indexOf(token)).filter((index) => index >= 0));
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (Number.isFinite(start) && end > start) {
    const extracted = parseJson<unknown>(cleaned.slice(start, end + 1), {});
    return asRecord(extracted);
  }
  throw new HttpError("OpenAI 回傳不是有效 JSON，請稍後重試。", 502);
}

function userSafeOpenAIError(json: JsonRecord, status: number): string {
  const error = asRecord(json.error);
  const message = String(error.message || `OpenAI request failed with HTTP ${status}.`);
  if (/invalid_api_key|incorrect api key|401/i.test(message)) return "OPENAI_API_KEY 無效，請重新設定 Cloudflare secret。";
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

function numberFrom(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function estimateTokens(input: unknown): number {
  const text = typeof input === "string" ? input : JSON.stringify(input || "");
  return Math.max(1, Math.ceil(text.length / 4));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
