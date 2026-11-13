import { browserFetchHtml, browserScreenshot } from "../adapters/browser";
import { D1Adapter } from "../adapters/d1";
import { OpenAIAdapter } from "../adapters/openai";
import { R2Adapter, publicArtifactUrl, uniqueStoredFilename } from "../adapters/r2";
import {
  AppContext,
  BRAND_ARCHETYPES,
  DEFAULT_BRAND,
  HttpError,
  JsonRecord,
  JsonValue,
  SourceRow,
  asRecord,
  clampScore,
  currentWeekStart,
  extensionOf,
  jsonResponse,
  normalizeBrandDnaPayload,
  normalizePlan,
  parseJson,
  sanitizeFilename,
  sourceTypeLabel,
  toJson,
  utcNow
} from "../schema";
import {
  DOCUMENT_EXTENSIONS,
  GLOBAL_SCAN_SOURCE_TYPES,
  IMAGE_EXTENSIONS,
  LIMITS,
  SOCIAL_SOURCE_TYPES,
  SUPPORTED_EXTENSIONS,
  TEXT_EXTENSIONS,
  URL_SOURCE_CONFIG
} from "../limits";

const SCHEMA_STRING: JsonRecord = { type: "string" };
const SCHEMA_INTEGER: JsonRecord = { type: "integer" };
function strictObject(properties: JsonRecord): JsonRecord {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
const arrayOf = (items: JsonRecord): JsonRecord => ({ type: "array", items });
/** Strict output schemas: the model cannot return malformed or padded JSON, so there are no parse failures to pay for twice. */
const SCHEMAS = {
  marketing: { name: "marketing_suggestions", schema: strictObject({ suggestions: arrayOf(strictObject({ label: SCHEMA_STRING, text: SCHEMA_STRING })) }) },
  imagePrompt: { name: "image_prompt", schema: strictObject({ english_prompt: SCHEMA_STRING, chinese_explanation: SCHEMA_STRING, visual_keywords: arrayOf(SCHEMA_STRING) }) },
  riskCheck: { name: "risk_check", schema: strictObject({
    is_compliant: { type: "boolean" },
    risk_level: { type: "string", enum: ["low", "medium", "high"] },
    violations: arrayOf(strictObject({ issue: SCHEMA_STRING, location: SCHEMA_STRING, suggestion: SCHEMA_STRING })),
    safe_content: SCHEMA_STRING,
    professional_rewrites: strictObject({ rewritten_versions: arrayOf(strictObject({ version: SCHEMA_STRING, content: SCHEMA_STRING, explanation: SCHEMA_STRING })) })
  }) },
  simulation: { name: "simulation", schema: strictObject({
    overall_score: SCHEMA_INTEGER,
    audience_predictions: arrayOf(strictObject({ audience: SCHEMA_STRING, acceptance_score: SCHEMA_INTEGER, attraction_reason: SCHEMA_STRING, positive_response: SCHEMA_STRING })),
    top_segments: arrayOf(strictObject({ rank: SCHEMA_INTEGER, audience: SCHEMA_STRING, reason: SCHEMA_STRING }))
  }) }
};

function sameIdSet(previous: unknown[], current: number[]): boolean {
  if (previous.length !== current.length || !current.length) return false;
  const stored = new Set(previous.map(Number));
  return current.every((id) => stored.has(id));
}
function dnaSourceIds(dna: JsonRecord): number[] {
  const ids = asRecord(dna._snapshot).source_result_ids;
  return Array.isArray(ids) ? ids.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
}
interface SourceSpec {
  source_type: string;
  input_kind: "url" | "text";
  url?: string | null;
  title?: string | null;
  content?: string;
  metadata?: JsonRecord;
}

export async function handleRequest(request: Request, ctx: AppContext): Promise<Response> {
  const app = new ApiApp(request, ctx);
  const db = new D1Adapter(ctx);
  try {
    const response = await app.dispatch();
    if (new URL(request.url).pathname.startsWith("/api/")) {
      const level = response.status >= 500 ? "error" : response.status >= 400 ? "warning" : "info";
      await db.logEvent({
        level,
        eventType: "http.request",
        message: `${request.method} ${new URL(request.url).pathname} -> ${response.status}`,
        stage: "http",
        durationMs: Date.now() - ctx.state.startedAt,
        details: { method: request.method, path: new URL(request.url).pathname, status_code: response.status }
      });
    }
    return response;
  } catch (error) {
    const httpError = error instanceof HttpError ? error : new HttpError(String(error instanceof Error ? error.message : error), 500);
    await db.logEvent({
      level: httpError.status >= 500 ? "error" : "warning",
      eventType: "api.error",
      message: httpError.message,
      stage: "exception",
      error: httpError.message,
      details: { path: new URL(request.url).pathname, status_code: httpError.status }
    }).catch(() => undefined);
    return jsonResponse({ success: false, error: httpError.message, ...httpError.extra,
      ...(ctx.state.aiUsage.length ? {ai_usage: aggregateUsage(ctx.state.aiUsage)} : {})
    }, httpError.status);
  } finally {
    // Generation can be billed even if persistence or a later step fails.
    if (ctx.state.aiUsage.length) await db.recordUsageEvent("openai_usage", 0, {
      calls: ctx.state.aiUsage.length,
      items: ctx.state.aiUsage as unknown as JsonValue
    }).catch(error => console.error(JSON.stringify({event:"openai.usage_persist_failed",request_id:ctx.state.requestId,error:String(error)})));
  }
}

class ApiApp {
  readonly request: Request;
  readonly ctx: AppContext;
  readonly db: D1Adapter;
  readonly r2: R2Adapter;
  readonly openai: OpenAIAdapter;
  readonly url: URL;

  constructor(request: Request, ctx: AppContext) {
    this.request = request;
    this.ctx = ctx;
    this.db = new D1Adapter(ctx);
    this.r2 = new R2Adapter(ctx);
    this.openai = new OpenAIAdapter(ctx, () => this.ensureAiBudget());
    this.url = new URL(request.url);
  }

  async dispatch(): Promise<Response> {
    const path = this.url.pathname;
    if (path.startsWith("/artifacts/")) return await this.getArtifact(path.split("/").pop() || "");
    if (!path.startsWith("/api/")) return this.error("Not found.", 404);
    if (path === "/api/health" && this.request.method === "GET") return this.success({ ok: true, environment: this.ctx.env.ENVIRONMENT || "demo", now: utcNow() });
    if (path === "/api/brand" && this.request.method === "GET") return this.success({ brand: await this.db.brand() });
    if (path === "/api/subscription") return await this.subscription();
    if (path === "/api/overview" && this.request.method === "GET") return await this.overview();
    if ((path === "/api/demo/import" || path === "/api/case/import") && this.request.method === "POST") return await this.demoImport();
    if (path === "/api/reset" && this.request.method === "POST") return await this.resetWorkspace();
    if (path === "/api/global-scan/run" && this.request.method === "POST") return await this.globalScanRun();
    if (path === "/api/global-scan/social-preview" && this.request.method === "POST") return await this.socialPreview();
    if (path.startsWith("/api/source-input/") && path.endsWith("/submit") && this.request.method === "POST") {
      const sourceType = path.slice("/api/source-input/".length, -"/submit".length);
      return await this.submitSourceInput(sourceType);
    }
    if (path === "/api/sources") return await this.sources();
    const sourceMatch = path.match(/^\/api\/sources\/(\d+)\/(extract|analyze|fallback|logs)$/);
    if (sourceMatch) return await this.sourceAction(Number(sourceMatch[1]), sourceMatch[2] || "");
    if (path === "/api/pipeline/run" && this.request.method === "POST") return await this.pipelineRun();
    if (path === "/api/jobs" && this.request.method === "GET") return await this.jobs();
    const jobMatch = path.match(/^\/api\/jobs\/(\d+)(?:\/logs)?$/);
    if (jobMatch && this.request.method === "GET") {
      return path.endsWith("/logs") ? await this.jobLogs(Number(jobMatch[1])) : await this.job(Number(jobMatch[1]));
    }
    if (path === "/api/logs" && this.request.method === "GET") return await this.logs();
    if (path === "/api/brand-dna") return await this.brandDna();
    if (path === "/api/brand-dna/override" && this.request.method === "POST") return await this.brandDnaOverride();
    if (path === "/api/diagnosis/insights" && this.request.method === "POST") return await this.diagnosisInsights();
    if (path === "/api/generation-history" && this.request.method === "GET") return await this.generationHistory();
    const detailMatch = path.match(/^\/api\/generation-detail\/([^/]+)$/);
    if (detailMatch && this.request.method === "GET") return await this.generationDetail(detailMatch[1] || "");
    if (path === "/api/latest-generated-post" && this.request.method === "GET") return await this.latestGeneratedPost();
    if (path === "/api/marketing-demand-suggestions" && this.request.method === "POST") return await this.marketingSuggestions();
    if (path === "/api/generate-personality-prompt" && this.request.method === "POST") return await this.personalityPrompt();
    if (path === "/api/generate-brand-image" && this.request.method === "POST") return await this.generateBrandImage();
    if (path === "/api/brand-character-image-prompt" && this.request.method === "POST") return await this.characterImagePrompt();
    if (path === "/api/generate-brand-character-image" && this.request.method === "POST") return await this.generateCharacterImage();
    if (path === "/api/generate-content" && this.request.method === "POST") return await this.generateContent();
    if (path === "/api/risk-check" && this.request.method === "POST") return await this.riskCheck();
    if (path === "/api/simulate" && this.request.method === "POST") return await this.simulate();
    return this.error("Not found.", 404);
  }

  success(payload: JsonRecord = {}, status = 200): Response {
    const out: JsonRecord = { success: true, ...payload };
    if (this.ctx.state.aiUsage.length && !out.ai_usage) out.ai_usage = aggregateUsage(this.ctx.state.aiUsage);
    return jsonResponse(out, status);
  }

  error(message: string, status = 400, extra: JsonRecord = {}): Response {
    const out: JsonRecord = { success: false, error: message, ...extra };
    if (this.ctx.state.aiUsage.length) out.ai_usage = aggregateUsage(this.ctx.state.aiUsage);
    return jsonResponse(out, status);
  }

  async jsonBody(): Promise<JsonRecord> {
    return asRecord(await this.request.json().catch(() => ({})));
  }

  async subscription(): Promise<Response> {
    if (this.request.method === "GET") return this.success({ subscription: await this.db.subscriptionPayload() });
    const payload = await this.jsonBody();
    this.ctx.state.plan = normalizePlan(payload.plan);
    return this.success({ subscription: await this.db.subscriptionPayload() });
  }

  async overview(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const brand = await this.db.brand();
    const sourceRows = await this.db.all<SourceRow>("SELECT * FROM raw_sources WHERE brand_id = ? ORDER BY id DESC LIMIT 8", [brandId]);
    const summary = await this.dashboardSummary(brandId);
    const artifacts = await this.latestArtifacts(brandId, 12);
    const diagnosisItems = await this.latestArtifacts(brandId, 1, "diagnosis_insight");
    const characterImages = await this.latestArtifacts(brandId, 1, "brand_character_image");
    return this.success({
      brand,
      summary,
      subscription: await this.db.subscriptionPayload(brandId),
      sources: await Promise.all(sourceRows.map((row) => this.serializeSource(row))),
      recent_artifacts: artifacts,
      latest_diagnosis: diagnosisItems[0] || null,
      latest_character_image: characterImages[0] || null,
      todos: overviewTodos(summary, artifacts)
    });
  }

  async demoImport(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const imported: JsonValue[] = [];
    const skipped: JsonValue[] = [];
    for (const [sourceType, demo] of Object.entries(DEMO_SOURCES)) {
      const rows = await this.db.all<{ metadata_json: string }>(
        "SELECT metadata_json FROM raw_sources WHERE brand_id = ? AND source_type = ?",
        [brandId, sourceType]
      );
      if (rows.some((row) => asRecord(parseJson(row.metadata_json, {})).demo_import === true)) {
        skipped.push({ source_type: sourceType, reason: "already imported" });
        continue;
      }
      const key = await this.createTextSource(brandId, sourceType, demo.title, demo.content, null, { demo_import: true, source_file: `${sourceType}.json` });
      imported.push({ id: key, source_type: sourceType, title: demo.title });
    }
    return this.success({ case_label: DEFAULT_BRAND.name, case_handle: DEFAULT_BRAND.handle, imported, skipped });
  }

  async resetWorkspace(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const tables = ["artifacts", "jobs", "brand_dna_snapshots", "analysis_results", "extraction_results", "raw_sources"];
    const deleted: JsonRecord = {};
    for (const table of tables) {
      const result = await this.ctx.env.DB.prepare(`DELETE FROM ${table} WHERE brand_id = ?`).bind(brandId).run();
      deleted[table] = Number(result.meta.changes || 0);
    }
    await this.r2.deleteBrandObjects(brandId);
    await this.db.logEvent({ level: "info", eventType: "workspace.reset", message: "Cloudflare demo workspace reset.", brandId, stage: "reset", details: { preserved_usage_events: true } });
    return this.success({ deleted, summary: await this.dashboardSummary(brandId) });
  }

  async sources(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    if (this.request.method === "GET") {
      const rows = await this.db.all<SourceRow>("SELECT * FROM raw_sources WHERE brand_id = ? ORDER BY id DESC", [brandId]);
      return this.success({ sources: await Promise.all(rows.map((row) => this.serializeSource(row))) });
    }
    const contentType = this.request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await this.request.formData();
      const sourceId = await this.createSourceFromForm(brandId, form);
      const source = await this.db.source(sourceId);
      return this.success({ source: source ? await this.serializeSource(source) : null });
    }
    const payload = await this.jsonBody();
    const spec: SourceSpec = {
      source_type: String(payload.source_type || "custom"),
      input_kind: payload.url ? "url" : "text",
      title: String(payload.title || "") || null,
      url: normalizeUrl(payload.url),
      content: String(payload.content || ""),
      metadata: {}
    };
    const sourceId = await this.createSourceFromSpec(brandId, spec);
    const source = await this.db.source(sourceId);
    return this.success({ source: source ? await this.serializeSource(source) : null });
  }

  async submitSourceInput(sourceType: string): Promise<Response> {
    if (!GLOBAL_SCAN_SOURCE_TYPES.includes(sourceType as typeof GLOBAL_SCAN_SOURCE_TYPES[number])) return this.error("不支援的資料來源類型。", 404);
    const brandId = await this.db.defaultBrandId();
    const form = await this.request.formData();
    const { spec, invalid } = await this.collectSingleSourceSpec(sourceType, form);
    if (invalid) return this.error("URL 格式無效，請使用 http:// 或 https:// 開頭的完整網址。", 400, { invalid_url: invalid });
    if (!spec) return this.error("請填寫此來源的 URL、文字，或完整手動貼文資料。", 400);
    const result = await this.processSingleSourceSpec(brandId, spec);
    const ok = String(asRecord(result.extraction).status || "") === "extracted";
    if (!ok) return this.error(String(asRecord(result.extraction).error || "擷取失敗，請使用手動補資料。"), 422, result);
    return this.success(result);
  }

  async globalScanRun(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const contentType = this.request.headers.get("content-type") || "";
    let specs: SourceSpec[] = [];
    let selectedRules: string[] = [];
    let internalRules = "";
    if (contentType.includes("multipart/form-data")) {
      const form = await this.request.formData();
      for (const sourceType of GLOBAL_SCAN_SOURCE_TYPES) {
        const { spec, invalid } = await this.collectSingleSourceSpec(sourceType, form);
        if (invalid) return this.error("部分 URL 格式無效，請使用 http:// 或 https:// 開頭的完整網址。", 400, { invalid_urls: [invalid] });
        if (spec) specs.push(spec);
      }
      selectedRules = form.getAll("selected_rules").map(String).filter(Boolean);
      internalRules = String(form.get("internal_rules") || "").trim();
    } else {
      const payload = await this.jsonBody();
      specs = collectSpecsFromJson(payload);
      selectedRules = Array.isArray(payload.selected_rules) ? payload.selected_rules.map(String) : [];
      internalRules = String(payload.internal_rules || "").trim();
    }
    if (specs.length < 3) return this.error("資料來源不足，請至少提供 3 種來源。", 400, { required_sources: 3, provided_sources: specs.length });
    const inputPayload: JsonRecord = { source_specs: specs as unknown as JsonValue, selected_rules: selectedRules, internal_rules: internalRules };
    const jobId = await this.db.createJob(brandId, "global_scan", inputPayload);
    try {
      await this.db.updateJob(jobId, "running", { markStarted: true });
      const result = await this.runSourcePipeline(brandId, jobId, specs, selectedRules, internalRules);
      await this.db.updateJob(jobId, "done", { result, markFinished: true });
      return this.success({ job: await this.db.fetchJob(jobId), result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.updateJob(jobId, "error", { error: message, markFinished: true });
      return this.error(message, error instanceof HttpError ? error.status : 500, { job: await this.db.fetchJob(jobId) });
    }
  }

  async socialPreview(): Promise<Response> {
    const payload = await this.jsonBody();
    const sourceType = String(payload.source_type || "").trim();
    const url = normalizeUrl(payload.url);
    if (!SOCIAL_SOURCE_TYPES.has(sourceType)) return this.error("社群貼文預覽僅支援 Instagram 或 Facebook。", 400);
    if (!url) return this.error("請輸入 http:// 或 https:// 開頭的有效網址。", 400);
    const text = await this.extractUrlText({ id: 0, brand_id: await this.db.defaultBrandId(), source_type: sourceType, input_kind: "url", title: `${sourceType} preview`, url, original_filename: null, raw_path: null, mime_type: null, status: "stored", metadata_json: null, created_at: utcNow(), updated_at: utcNow() });
    const posts = splitSocialPosts(text.extractedText, sourceType);
    if (!posts.length) return this.error("自動擷取找不到可用貼文內容，請改用手動輸入。", 422);
    return this.success({ source_type: sourceType, url, posts, artifact_path: text.artifactPath || null, metadata: text.metadata });
  }

  async sourceAction(sourceId: number, action: string): Promise<Response> {
    if (action === "logs") return await this.sourceLogs(sourceId);
    const source = await this.db.source(sourceId);
    if (!source) return this.error("找不到來源。", 404);
    if (action === "fallback") {
      const payload = await this.jsonBody();
      const content = String(payload.content || "").trim();
      if (!content) return this.error("Fallback content is required.", 400);
      const fallbackId = await this.createTextSource(source.brand_id, source.source_type, String(payload.title || `${source.title || sourceTypeLabel(source.source_type)} fallback`), content, source.url, {
        manual_fallback: true,
        fallback_for_source_id: sourceId,
        fallback_for_url: source.url || "",
        fallback_for_source_type: source.source_type
      });
      const extraction = await this.extractSource(fallbackId);
      const analysis = payload.analyze === false ? null : extraction.status === "extracted" ? await this.analyzeSource(fallbackId) : null;
      const fallbackSource = await this.db.source(fallbackId);
      return this.success({ source: fallbackSource ? await this.serializeSource(fallbackSource) : null, extraction, analysis });
    }
    const jobId = await this.db.createJob(source.brand_id, `${action}_source`, { source_id: sourceId });
    await this.db.updateJob(jobId, "running", { markStarted: true });
    if (action === "extract") {
      const extraction = await this.extractSource(sourceId);
      await this.db.updateJob(jobId, extraction.status === "extracted" ? "done" : "error", { result: extraction, error: String(extraction.error || ""), markFinished: true });
      const job = await this.db.fetchJob(jobId);
      if (extraction.status !== "extracted") return this.error(String(extraction.error || "擷取失敗，請使用手動補資料。"), 422, { job, extraction });
      return this.success({ job, extraction });
    }
    if (action === "analyze") {
      const analysis = await this.analyzeSource(sourceId);
      await this.db.updateJob(jobId, analysis.status === "analyzed" ? "done" : "error", { result: analysis, error: String(analysis.error || ""), markFinished: true });
      const job = await this.db.fetchJob(jobId);
      if (analysis.status !== "analyzed") return this.error(String(analysis.error || "分析失敗，請補充來源文字後重試。"), 422, { job, analysis });
      return this.success({ job, analysis });
    }
    return this.error("Not found.", 404);
  }

  /**
   * Processes at most LIMITS.pipelineSourcesPerRequest sources per call, then answers with a cursor.
   * The browser keeps calling until `done`, so a long pipeline never exceeds the Free plan's
   * per-invocation subrequest/query limits, and Brand DNA is built once at the end.
   */
  async pipelineRun(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const payload = await this.jsonBody();
    const rawIds = Array.isArray(payload.source_ids) ? payload.source_ids.map((item) => Number(item)).filter(Number.isFinite) : [];
    const cursor = Math.max(0, Number(payload.cursor) || 0);
    const total = Number((await this.db.first<{ c: number }>(
      `SELECT COUNT(*) c FROM raw_sources WHERE brand_id = ?${rawIds.length ? ` AND id IN (${rawIds.map(() => "?").join(",")})` : ""}`, [brandId, ...rawIds]
    ))?.c || 0);
    if (!total) return this.error("目前沒有資料來源，請先新增或匯入 demo data。", 400);
    // One query finds every source whose latest analysis is not yet successful (instead of two queries per source).
    const pending = await this.db.all<SourceRow>(
      `SELECT rs.* FROM raw_sources rs
       WHERE rs.brand_id = ? AND rs.id > ?${rawIds.length ? ` AND rs.id IN (${rawIds.map(() => "?").join(",")})` : ""}
         AND COALESCE((SELECT ar.status FROM analysis_results ar WHERE ar.source_id = rs.id ORDER BY ar.id DESC LIMIT 1), '') <> 'analyzed'
       ORDER BY rs.id`,
      [brandId, cursor, ...rawIds]
    );
    const existingJob = Number(payload.job_id) > 0 ? await this.db.fetchJob(Number(payload.job_id)) : null;
    const jobId = existingJob && String(existingJob.job_type) === "brand_dna_pipeline" ? Number(existingJob.id) : await this.db.createJob(brandId, "brand_dna_pipeline", { source_ids: rawIds.length ? rawIds : "all" });
    await this.db.updateJob(jobId, "running", { markStarted: true });
    try {
      const batch = pending.slice(0, LIMITS.pipelineSourcesPerRequest);
      const extracted: JsonValue[] = [];
      const analyzed: JsonValue[] = [];
      const errors: JsonValue[] = [];
      for (const row of batch) {
        let extraction = await this.db.latestExtraction(row.id);
        if (!extraction || extraction.status !== "extracted") extraction = await this.extractSource(row.id);
        extracted.push({ source_id: row.id, status: String(extraction.status || ""), error: String(extraction.error || "") });
        if (String(extraction.status || "") !== "extracted") {
          errors.push({ source_id: row.id, stage: "extract", error: String(extraction.error || "") });
          continue;
        }
        const analysis = await this.analyzeSource(row.id);
        analyzed.push({ source_id: row.id, status: String(analysis.status || ""), error: String(analysis.error || "") });
        if (String(analysis.status || "") !== "analyzed") errors.push({ source_id: row.id, stage: "analyze", error: String(analysis.error || "") });
      }
      const remaining = pending.length - batch.length;
      const nextCursor = batch.length ? Number(batch[batch.length - 1]?.id || cursor) : cursor;
      const result: JsonRecord = { extracted, analyzed, errors, total, remaining, cursor: nextCursor, done: remaining === 0 };
      if (remaining === 0) {
        result.brand_dna = await this.buildBrandDna(brandId, { force: payload.force === true });
        await this.db.updateJob(jobId, "done", { result, markFinished: true });
      } else {
        await this.db.updateJob(jobId, "running", { result });
      }
      return this.success({ job: await this.db.fetchJob(jobId), result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.updateJob(jobId, "error", { error: message, markFinished: true });
      return this.error(message, 500, { job: await this.db.fetchJob(jobId) });
    }
  }

  async jobs(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const rows = await this.db.all<JsonRecord>("SELECT * FROM jobs WHERE brand_id = ? ORDER BY id DESC LIMIT 30", [brandId]);
    const jobs = rows.map((row): JsonRecord => {
      const out: JsonRecord = { ...row, input: parseJson(row.input_json, {}), result: parseJson(row.result_json, null) };
      delete out.input_json;
      delete out.result_json;
      return out;
    });
    return this.success({ jobs: jobs as unknown as JsonValue });
  }

  async job(jobId: number): Promise<Response> {
    const job = await this.db.fetchJob(jobId);
    return job ? this.success({ job }) : this.error("找不到 job。", 404);
  }

  async logs(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const logs = await this.fetchLogs({ brandId, limit: Number(this.url.searchParams.get("limit") || 100), level: this.url.searchParams.get("level"), eventType: this.url.searchParams.get("event_type") });
    return this.success({ logs, log_file: "D1 system_logs + R2 logs/{date}/..." });
  }

  async jobLogs(jobId: number): Promise<Response> {
    const job = await this.db.fetchJob(jobId);
    if (!job) return this.error("找不到 job。", 404);
    return this.success({ logs: await this.fetchLogs({ jobId, limit: Number(this.url.searchParams.get("limit") || 100) }), log_file: "D1 system_logs + R2 logs/{date}/..." });
  }

  async sourceLogs(sourceId: number): Promise<Response> {
    const source = await this.db.source(sourceId);
    if (!source) return this.error("找不到來源。", 404);
    return this.success({ logs: await this.fetchLogs({ sourceId, limit: Number(this.url.searchParams.get("limit") || 100) }), log_file: "D1 system_logs + R2 logs/{date}/..." });
  }

  async brandDna(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    if (this.request.method === "GET") {
      const dna = await this.db.activeBrandDna(brandId);
      return this.success({ configured: Boolean(dna), brand_dna: dna ? normalizeBrandDnaPayload(dna) : null });
    }
    const payload = await this.jsonBody();
    if (!Object.keys(payload).length) return this.error("Brand DNA payload 不可為空。", 400);
    const normalized = normalizeBrandDnaPayload(payload);
    const snapshotId = await this.db.saveBrandDna(brandId, normalized, { manual_post: true });
    return this.success({ snapshot_id: snapshotId, brand_dna: normalizeBrandDnaPayload(await this.db.activeBrandDna(brandId)) });
  }

  async brandDnaOverride(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const payload = await this.jsonBody();
    const current = asRecord(await this.db.activeBrandDna(brandId));
    const overrides = asRecord(payload.overrides || payload);
    const merged = { ...current, ...overrides };
    for (const key of Object.keys(merged)) if (key.startsWith("_")) delete merged[key];
    const snapshotId = await this.db.saveBrandDna(brandId, normalizeBrandDnaPayload(merged), overrides, dnaSourceIds(current));
    return this.success({ snapshot_id: snapshotId, brand_dna: normalizeBrandDnaPayload(await this.db.activeBrandDna(brandId)) });
  }

  async diagnosisInsights(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const dna = await this.requireBrandDna();
    const summary = await this.dashboardSummary(brandId);
    const analyses = await this.latestAnalyzedPayloads(brandId, 12);
    if (!analyses.length) return this.error("目前沒有可用的來源分析結果，請先整理並分析資料來源。", 400);
    const result = await this.openai.generateJson(
      "diagnosis",
      `Dashboard summary:\n${toJson(summary)}\n\nBrand DNA:\n${toJson(dna).slice(0, 12000)}\n\nAnalyzed sources:\n${toJson(analyses).slice(0, 24000)}\n\nReturn compact JSON with global_scan, archetype_position, brand_positioning, brand_traits, brand_voice, target_audience, character, generation_settings.`,
      "You are a rigorous brand role diagnostician. Produce evidence-grounded 12-archetype and brand-character insight in Traditional Chinese.",
      { temperature: 0.25 }
    );
    const normalized = normalizeDiagnosis(result, summary, dna);
    const artifactId = await this.db.createArtifact(brandId, "diagnosis_insight", "品牌角色診斷", normalized);
    await this.db.recordUsageEvent("diagnosis_insight", 1, { artifact_id: artifactId });
    return this.success({ insight: normalized, artifact_id: artifactId, subscription: await this.db.subscriptionPayload(brandId) });
  }

  async generationHistory(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const rows = await this.db.all<JsonRecord>("SELECT * FROM artifacts WHERE brand_id = ? ORDER BY id DESC LIMIT 30", [brandId]);
    const history = rows.map((row) => {
      const payload = parseJson<JsonRecord>(row.payload_json, {});
      const fileUrl = String(payload.file_url || publicArtifactUrl(String(row.file_path || "")) || "");
      return {
        id: Number(row.id || 0),
        filename: String(row.id || ""),
        timestamp: String(row.created_at || ""),
        type: String(row.artifact_type || ""),
        title: String(row.title || ""),
        file_url: fileUrl,
        summary: String(payload.final_caption || payload.personality_narrative || payload.summary || row.title || "").slice(0, 120),
        content_count: Array.isArray(payload.generated_content) ? payload.generated_content.length : 0
      };
    });
    return this.success({ history: history as unknown as JsonValue });
  }

  async generationDetail(identifier: string): Promise<Response> {
    if (!/^\d+$/.test(identifier)) return this.error("找不到產出紀錄。", 404);
    const row = await this.db.artifactById(Number(identifier));
    if (!row) return this.error("找不到產出紀錄。", 404);
    const payload = parseJson<JsonRecord>(row.payload_json, {});
    const item: JsonRecord = { ...row, payload, file_url: String(payload.file_url || publicArtifactUrl(String(row.file_path || "")) || "") };
    delete item.payload_json;
    return this.success({ data: item });
  }

  async latestGeneratedPost(): Promise<Response> {
    const brandId = await this.db.defaultBrandId();
    const row = await this.db.first<JsonRecord>("SELECT * FROM artifacts WHERE brand_id = ? AND artifact_type = 'content_generation' ORDER BY id DESC LIMIT 1", [brandId]);
    if (!row) return this.success({ generated: null, artifact_id: null });
    return this.success({ generated: parseJson(row.payload_json, {}), artifact_id: Number(row.id || 0) });
  }

  async marketingSuggestions(): Promise<Response> {
    await this.requireFeature("generation");
    const brand = asRecord(await this.db.brand() || DEFAULT_BRAND);
    const dna = normalizeBrandDnaPayload(await this.db.activeBrandDna());
    const prompt = `Generate exactly three Traditional Chinese marketing request quick-button suggestions for a Taiwanese restaurant dashboard.\nBrand:\n${toJson(brand)}\nBrand DNA:\n${toJson(dna)}\nReturn JSON {"suggestions":[{"label":"...","text":"..."}]}.`;
    const result = await this.openai.generateJson("marketing_suggestions", prompt, "Create practical, concise Taiwanese restaurant marketing requests. Do not write final post copy.", { temperature: 0.55, maxOutputTokens: 900, schema: SCHEMAS.marketing });
    const suggestions = normalizeSuggestions(result, brand, dna);
    await this.db.recordUsageEvent("marketing_suggestions", 1, { suggestions: suggestions.map((item) => item.label) });
    return this.success({ suggestions: suggestions as unknown as JsonValue, subscription: await this.db.subscriptionPayload() });
  }

  async personalityPrompt(): Promise<Response> {
    await this.requireFeature("brand_image", "brand_image");
    const payload = await this.jsonBody();
    const dna = normalizeBrandDnaPayload(payload.brand_dna || await this.requireBrandDna());
    const result = await this.openai.generateJson(
      "image_prompt",
      `Create a brand-consistent image generation prompt for restaurant marketing.\nBrand DNA:\n${toJson(dna)}\nStyle: ${String(payload.art_style || "")}\nColor tone: ${String(payload.color_tone || "")}\nScene elements: ${String(payload.scene_elements || "")}\nReturn JSON {"english_prompt":"...","chinese_explanation":"...","visual_keywords":["..."]}.`,
      "Write production-ready image prompts for brand-safe restaurant marketing visuals.",
      { temperature: 0.35, schema: SCHEMAS.imagePrompt }
    );
    const artifactId = await this.db.createArtifact(await this.db.defaultBrandId(), "image_prompt", "圖片設定", result);
    await this.db.recordUsageEvent("image_prompt", 1, { artifact_id: artifactId });
    return this.success({ prompt: String(result.english_prompt || ""), explanation: String(result.chinese_explanation || ""), keywords: Array.isArray(result.visual_keywords) ? result.visual_keywords : [], result, artifact_id: artifactId, subscription: await this.db.subscriptionPayload() });
  }

  async generateBrandImage(): Promise<Response> {
    await this.requireFeature("brand_image", "brand_image");
    const payload = await this.jsonBody();
    const prompt = String(payload.prompt || "").trim();
    if (!prompt) return this.error("請提供圖片提示詞。", 400);
    const brandId = await this.db.defaultBrandId();
    const size = String(payload.size || "1024x1024");
    await this.r2.ensureWriteCapacity();
    const image = await this.openai.generateImage("brand_image", brandSafeImagePrompt(prompt), { size, quality: "low" });
    const filename = `brand_image_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}_${crypto.randomUUID().slice(0, 8)}.webp`;
    const key = await this.r2.putBytes(`generated-images/${brandId}/${filename}`, image.bytes, image.contentType);
    const fileUrl = publicArtifactUrl(key);
    const out: JsonRecord = { model: image.model, prompt, size, image_path: key, file_url: fileUrl || "" };
    if (payload.content_artifact_id !== undefined) out.content_artifact_id = Number(payload.content_artifact_id);
    const artifactId = await this.db.createArtifact(brandId, "brand_image", "品牌圖片", out, { filePath: key });
    if (out.content_artifact_id) await this.linkConceptImage(Number(out.content_artifact_id), artifactId, out);
    await this.db.recordUsageEvent("brand_image", 1, { artifact_id: artifactId });
    return this.success({ image_url: fileUrl || "", file_url: fileUrl || "", model: image.model, artifact_id: artifactId, subscription: await this.db.subscriptionPayload() });
  }

  async characterImagePrompt(): Promise<Response> {
    await this.requireFeature("brand_image");
    const brandId = await this.db.defaultBrandId();
    const dna = normalizeBrandDnaPayload(await this.requireBrandDna());
    const promptInput = characterImagePromptInput(dna);
    const result = await this.openai.generateJson(
      "image_prompt",
      `Create a production-ready English image generation prompt for one original full-body brand ambassador character.\nInputs:\n${toJson(promptInput)}\nReturn JSON {"english_prompt":"...","prompt_preview_zh":"...","used_inputs":{},"style_keywords":["..."]}.`,
      "Write one concise but complete English prompt. Require full body, 3/4 view, no cropping, no readable text, no logos, no real people.",
      { temperature: 0.35 }
    );
    const normalized = normalizeCharacterPrompt(result, promptInput);
    const artifactId = await this.db.createArtifact(brandId, "brand_character_image_prompt", "品牌角色圖提示詞", normalized);
    return this.success({ prompt: String(normalized.english_prompt), prompt_preview_zh: String(normalized.prompt_preview_zh), used_inputs: asRecord(normalized.used_inputs), style_keywords: normalized.style_keywords || [], artifact_id: artifactId, subscription: await this.db.subscriptionPayload(brandId) });
  }

  async generateCharacterImage(): Promise<Response> {
    await this.requireFeature("brand_image", "brand_image");
    const brandId = await this.db.defaultBrandId();
    const dna = normalizeBrandDnaPayload(await this.requireBrandDna());
    const payload = await this.jsonBody();
    const prompt = String(payload.prompt || "").trim();
    if (!prompt) return this.error("缺少角色圖 image prompt，請先產生提示詞。", 400);
    const size = String(payload.size || "1024x1536");
    const quality = "low";
    await this.r2.ensureWriteCapacity();
    const image = await this.openai.generateImage("character_image", prompt, { size, quality });
    const filename = `brand_character_image_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}_${crypto.randomUUID().slice(0, 8)}.webp`;
    const key = await this.r2.putBytes(`generated-images/${brandId}/${filename}`, image.bytes, image.contentType);
    const fileUrl = publicArtifactUrl(key) || "";
    const out: JsonRecord = { model: image.model, prompt, size, quality, image_path: key, file_url: fileUrl };
    const artifactId = await this.db.createArtifact(brandId, "brand_character_image", "品牌角色圖", out, { filePath: key });
    const imageInfo: JsonRecord = { artifact_id: artifactId, file_url: fileUrl, prompt, model: image.model, size, created_at: utcNow() };
    const updated: JsonRecord = { ...dna, brand_character: { ...asRecord(dna.brand_character), character_image: imageInfo } };
    for (const keyName of Object.keys(updated)) if (keyName.startsWith("_")) delete updated[keyName];
    const snapshotId = await this.db.saveBrandDna(brandId, normalizeBrandDnaPayload(updated), { character_image_artifact_id: artifactId }, dnaSourceIds(dna));
    await this.db.recordUsageEvent("brand_image", 1, { artifact_id: artifactId, snapshot_id: snapshotId, kind: "brand_character_image" });
    return this.success({ image_url: `data:${image.contentType};base64,${arrayBufferToBase64(image.bytes)}`, file_url: fileUrl, character_image: imageInfo, snapshot_id: snapshotId, model: image.model, artifact_id: artifactId, subscription: await this.db.subscriptionPayload(brandId) });
  }

  async generateContent(): Promise<Response> {
    await this.requireFeature("generation", "content_generation");
    const brandId = await this.db.defaultBrandId();
    const dna = normalizeBrandDnaPayload(await this.requireBrandDna());
    const payload = await this.jsonBody();
    const platform = normalizeContentPlatform(payload.content_type || payload.platform || "instagram");
    if (!platform) return this.error("圖文生成只支援 Instagram 或 Facebook。", 400);
    const context = String(payload.context || "").trim();
    if (!context) return this.error("context is required.", 400);
    const compliance = complianceSettings(payload, dna);
    const result = await this.openai.generateJson(
      "content_generation",
      `Generate one final compliant social post for a Taiwanese restaurant brand.\nBrand DNA:\n${brandDnaPromptBlock(dna)}\nPlatform: ${platform === "instagram" ? "Instagram" : "Facebook"}\nCompliance:\n${toJson(compliance)}\nRequest/context:\n${context}\nReturn JSON with platform, final_caption, image_prompt, generated_content, hashtags, compliance_notes, brand_fit_notes, target_audience.`,
      "You are a senior Taiwanese restaurant brand copywriter. Generate final IG/FB-ready Traditional Chinese copy and a grounded text-free image prompt.",
      { temperature: 0.65 }
    );
    const normalized = normalizeContentResult(result, platform, dna, compliance, context);
    const artifactId = await this.db.createArtifact(brandId, "content_generation", context.slice(0, 40) || "社群貼文", normalized);
    await this.db.recordUsageEvent("content_generation", 1, { artifact_id: artifactId });
    return this.success({ generated: normalized, artifact_id: artifactId, subscription: await this.db.subscriptionPayload(brandId) });
  }

  async riskCheck(): Promise<Response> {
    await this.requireFeature("gatekeeper");
    const payload = await this.jsonBody();
    const content = String(payload.content || "").trim();
    if (!content) return this.error("content is required.", 400);
    const brandId = await this.db.defaultBrandId();
    const dna = normalizeBrandDnaPayload(await this.db.activeBrandDna(brandId) || {});
    const result = await this.openai.generateJson(
      "risk_check",
      `Check this marketing content for compliance and brand-rule risk.\nContent:\n${content}\nBrand data:\n${brandDnaPromptBlock(dna)}\nCustom rules:\n${toJson(payload.custom_rules || [])}\nForbidden words:\n${toJson(payload.forbidden_words || [])}\nReturn JSON {"is_compliant":true,"risk_level":"low|medium|high","violations":[],"safe_content":"...","professional_rewrites":{"rewritten_versions":[{"version":"版本 1","content":"...","explanation":"..."}]}}.`,
      "You are a conservative marketing compliance and brand-safety reviewer. Use Traditional Chinese.",
      { temperature: 0.15, schema: SCHEMAS.riskCheck }
    );
    const artifactId = await this.db.createArtifact(brandId, "risk_check", "規範檢查", { input: content, custom_rules: payload.custom_rules || [], forbidden_words: payload.forbidden_words || [], result });
    await this.db.recordUsageEvent("risk_check", 1, { artifact_id: artifactId });
    return this.success({ risk_analysis: result, artifact_id: artifactId, subscription: await this.db.subscriptionPayload(brandId) });
  }

  async simulate(): Promise<Response> {
    await this.requireFeature("simulation");
    const brandId = await this.db.defaultBrandId();
    const dna = normalizeBrandDnaPayload(await this.requireBrandDna());
    const payload = await this.jsonBody();
    const content = String(payload.content || "").trim();
    if (!content) return this.error("content is required.", 400);
    const audiences = Array.isArray(payload.audiences) ? payload.audiences.map(String).filter(Boolean) : ["年輕上班族", "家庭客", "大學生", "社群追蹤者"];
    const result = await this.openai.generateJson(
      "simulation",
      `Run a positive market prediction for this generated social post.
Brand data:
${brandDnaPromptBlock(dna)}
Post:
${content}
Audiences:
${toJson(audiences)}
Return only this JSON shape:
{
  "overall_score": 0-100 integer percentage,
  "audience_predictions": [
    {
      "audience": "exact audience string from the Audiences array",
      "acceptance_score": 0-100 integer percentage,
      "attraction_reason": "why this audience is attracted",
      "positive_response": "likely positive reaction"
    }
  ],
  "top_segments": [
    {"rank": 1, "audience": "exact audience string", "reason": "..."},
    {"rank": 2, "audience": "exact audience string", "reason": "..."}
  ]
}
Rules:
- audience_predictions must contain exactly one item for every input audience, in the same order.
- Scores are percentages on a 0-100 scale, not 0-10.
- Vary scores according to audience fit; do not give every audience the same score unless the evidence truly supports it.
- Do not include concerns or negative reactions.`,
      "Estimate positive audience acceptance as directional hypotheses, not factual survey results. Use Traditional Chinese.",
      { temperature: 0.45, schema: SCHEMAS.simulation }
    );
    const normalized = normalizeSimulation(result, audiences);
    const artifactId = await this.db.createArtifact(brandId, "simulation", "市場預測", { input: content, audiences, result: normalized, raw_model_result: result });
    await this.db.recordUsageEvent("simulation", 1, { artifact_id: artifactId });
    return this.success({ simulation: normalized, artifact_id: artifactId, subscription: await this.db.subscriptionPayload(brandId) });
  }

  async getArtifact(filename: string): Promise<Response> {
    const safe = sanitizeFilename(filename);
    const artifact = await this.db.artifactByFilename(safe);
    const candidates = [
      artifact ? String(artifact.file_path || "") : "",
      `generated-images/1/${safe}`,
      `artifacts/1/${safe}`,
      safe
    ].filter(Boolean);
    for (const key of candidates) {
      const object = await this.r2.getObject(key);
      if (!object) continue;
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=3600");
      return new Response(object.body, { headers });
    }
    return new Response("Artifact not found.", { status: 404 });
  }

  private aiBudgetChecked = false;
  /** Runs before every OpenAI call (once per request): stops the demo once this week's spend reaches the budget. */
  async ensureAiBudget(): Promise<void> {
    if (this.aiBudgetChecked) return;
    const budget = Number(this.ctx.env.OPENAI_WEEKLY_BUDGET_USD || LIMITS.weeklyAiBudgetUsd);
    if (Number.isFinite(budget) && budget > 0) {
      const spent = await this.db.weeklyAiCostUsd();
      if (spent >= budget) throw new HttpError(`本週展示版 AI 預算（US$${budget}）已用完，請下週再試。`, 429);
    }
    this.aiBudgetChecked = true;
  }

  async requireFeature(capability: string, usageFeature?: string): Promise<void> {
    const brandId = await this.db.defaultBrandId();
    const subscription = await this.db.subscriptionPayload(brandId);
    const plan = normalizePlan(subscription.plan);
    const features = asRecord(asRecord(subscription.plan_info).features);
    if (!features[capability]) throw new HttpError(`${capability} is not available on the ${plan} plan.`, 403, { subscription });
    if (await this.db.totalWeeklyUsage(brandId) >= LIMITS.globalWeeklyHardLimit) throw new HttpError("本週展示版全域用量已達上限，請稍後再試。", 429, { subscription });
    if (usageFeature) {
      const quota = asRecord(asRecord(subscription.quotas)[usageFeature]);
      if (quota.limit !== null && Number(quota.remaining || 0) <= 0) throw new HttpError(`${usageFeature} weekly quota has been used up for the ${plan} plan.`, 429, { subscription });
    }
  }

  async requireBrandDna(): Promise<JsonRecord> {
    const dna = await this.db.activeBrandDna(await this.db.defaultBrandId());
    if (!dna) throw new HttpError("尚未建立 Brand DNA，請先到資料中心建立品牌角色。", 400);
    return normalizeBrandDnaPayload(dna);
  }

  async createTextSource(brandId: number, sourceType: string, title: string, content: string, url: string | null, metadata: JsonRecord): Promise<number> {
    const tempId = crypto.randomUUID();
    const key = `rawdata/${brandId}/text/${tempId}_${sanitizeFilename(sourceType)}.txt`;
    await this.r2.putText(key, content);
    return await this.db.createSource({ brandId, sourceType, inputKind: "text", title, url, rawPath: key, mimeType: "text/plain", metadata });
  }

  async createSourceFromSpec(brandId: number, spec: SourceSpec, jobId?: number): Promise<number> {
    const metadata = { ...(spec.metadata || {}), source_url_kind: spec.source_type } as JsonRecord;
    if (jobId) metadata.global_scan_id = jobId;
    if (spec.input_kind === "text") {
      return await this.createTextSource(brandId, spec.source_type, spec.title || `${sourceTypeLabel(spec.source_type)} 手動輸入`, spec.content || "", spec.url || null, metadata);
    }
    return await this.db.createSource({ brandId, sourceType: spec.source_type, inputKind: "url", title: spec.title || `${sourceTypeLabel(spec.source_type)} URL 擷取`, url: spec.url || null, metadata });
  }

  async processSingleSourceSpec(brandId: number, spec: SourceSpec): Promise<JsonRecord> {
    const sourceId = await this.createSourceFromSpec(brandId, spec);
    const extraction = await this.extractSource(sourceId);
    const analysis = extraction.status === "extracted" ? await this.analyzeSource(sourceId) : null;
    const source = await this.db.source(sourceId);
    return { source: source ? await this.serializeSource(source) : null, extraction, analysis };
  }

  async createSourceFromForm(brandId: number, form: FormData): Promise<number> {
    const sourceType = String(form.get("source_type") || "custom");
    const title = String(form.get("title") || "") || null;
    const url = normalizeUrl(form.get("url"));
    const social = await this.manualSocialPayload(sourceType, form, "");
    if (social) {
      return await this.createTextSource(brandId, sourceType, title || `${sourceTypeLabel(sourceType)} 手動貼文`, social.content, url, social.metadata);
    }
    const fileValue = form.get("file");
    if (fileValue instanceof File && fileValue.name) {
      if (fileValue.size > LIMITS.maxUploadBytes) throw new HttpError("單檔上限為 5MB。", 413);
      const ext = extensionOf(fileValue.name);
      const inputKind = IMAGE_EXTENSIONS.has(ext) ? "image" : "file";
      const stored = await this.r2.putFile(`uploads/${brandId}`, fileValue);
      const metadata: JsonRecord = {};
      if (!SUPPORTED_EXTENSIONS.has(ext)) metadata.unsupported_extension = ext;
      if (url) metadata.source_url = url;
      return await this.db.createSource({ brandId, sourceType, inputKind, title: title || fileValue.name, url, originalFilename: fileValue.name, rawPath: stored.key, mimeType: stored.contentType, metadata });
    }
    const content = String(form.get("content") || "");
    if (content.trim()) return await this.createTextSource(brandId, sourceType, title || `${sourceTypeLabel(sourceType)} 手動輸入`, content, url, {});
    if (url) return await this.db.createSource({ brandId, sourceType, inputKind: "url", title: title || url, url, metadata: {} });
    throw new HttpError("請提供文字、檔案或 URL。", 400);
  }

  async collectSingleSourceSpec(sourceType: string, form: FormData): Promise<{ spec: SourceSpec | null; invalid: JsonRecord | null }> {
    const modeRaw = String(form.get(`${sourceType}_mode`) || "").toLowerCase();
    const mode = modeRaw === "url" || modeRaw === "manual" ? modeRaw : SOCIAL_SOURCE_TYPES.has(sourceType) ? "manual" : "url";
    if (mode === "url") {
      const rawUrl = String(form.get(`${sourceType}_url`) || "").trim();
      if (!rawUrl) return { spec: null, invalid: null };
      const url = normalizeUrl(rawUrl);
      if (!url) return { spec: null, invalid: { source_type: sourceType, url: rawUrl } };
      if (SOCIAL_SOURCE_TYPES.has(sourceType)) {
        const auto = autoSocialPayload(sourceType, form);
        if (auto) return { spec: { source_type: sourceType, input_kind: "text", url, title: `${sourceTypeLabel(sourceType)} 自動擷取貼文`, content: auto.content, metadata: { ...auto.metadata, source_input_mode: "url", automation: "social_preview_in_source_input", source_url: url } }, invalid: null };
      }
      return { spec: { source_type: sourceType, input_kind: "url", url, title: `${sourceTypeLabel(sourceType)} URL 擷取`, metadata: { source_input_mode: "url" } }, invalid: null };
    }
    if (SOCIAL_SOURCE_TYPES.has(sourceType)) {
      const manual = await this.manualSocialPayload(sourceType, form, `${sourceType}_`);
      return manual
        ? { spec: { source_type: sourceType, input_kind: "text", url: normalizeUrl(form.get(`${sourceType}_url`)), title: `${sourceTypeLabel(sourceType)} 手動貼文`, content: manual.content, metadata: { ...manual.metadata, source_input_mode: "manual", automation: "manual_in_global_scan" } }, invalid: null }
        : { spec: null, invalid: null };
    }
    const content = String(form.get(`${sourceType}_content`) || "").trim();
    if (!content) return { spec: null, invalid: null };
    return { spec: { source_type: sourceType, input_kind: "text", url: normalizeUrl(form.get(`${sourceType}_url`)), title: `${sourceTypeLabel(sourceType)} 手動輸入`, content, metadata: { source_input_mode: "manual", automation: "manual_in_global_scan" } }, invalid: null };
  }

  async manualSocialPayload(sourceType: string, form: FormData, prefix: string): Promise<{ content: string; metadata: JsonRecord } | null> {
    const brandId = await this.db.defaultBrandId();
    let hasAny = false;
    const blocks = [`${sourceTypeLabel(sourceType)} 手動輸入貼文，共 ${LIMITS.socialPostCount} 篇`];
    const posts: JsonValue[] = [];
    for (let index = 1; index <= LIMITS.socialPostCount; index += 1) {
      const content = String(form.get(`${prefix}post_content_${index}`) || "").trim();
      const file = form.get(`${prefix}post_image_${index}`);
      if (content || file instanceof File) hasAny = true;
      if (!hasAny) continue;
    }
    if (!hasAny) return null;
    if (!SOCIAL_SOURCE_TYPES.has(sourceType)) throw new HttpError("手動貼文輸入僅支援 Instagram 或 Facebook。", 400);
    for (let index = 1; index <= LIMITS.socialPostCount; index += 1) {
      const content = String(form.get(`${prefix}post_content_${index}`) || "").trim();
      const file = form.get(`${prefix}post_image_${index}`);
      if (!content || !(file instanceof File) || !file.name) throw new HttpError(`${sourceTypeLabel(sourceType)} 手動輸入需要 5 篇貼文內容與 5 張圖片。`, 400);
      if (file.size > LIMITS.maxUploadBytes) throw new HttpError("單檔上限為 5MB。", 413);
      const ext = extensionOf(file.name);
      if (!IMAGE_EXTENSIONS.has(ext)) throw new HttpError(`第 ${index} 篇圖片格式不支援。`, 400);
      const stored = await this.r2.putFile(`rawdata/${brandId}/manual_social_images/${sourceType}`, file);
      posts.push({ index, image_path: stored.key, original_filename: file.name, mime_type: stored.contentType });
      blocks.push(`## Post ${index}\n${content}\nImage filename: ${file.name}\nImage path: ${stored.key}`);
    }
    return { content: blocks.join("\n\n"), metadata: { manual_social_posts: posts, manual_post_count: LIMITS.socialPostCount, manual_image_count: LIMITS.socialPostCount } };
  }

  async extractSource(sourceId: number): Promise<JsonRecord> {
    const source = await this.db.source(sourceId);
    if (!source) throw new HttpError("找不到來源。", 404);
    try {
      if (source.input_kind === "url") {
        const result = await this.extractUrlText(source);
        return await this.db.createExtractionResult(source, "extracted", result.extractedText, { artifactPath: result.artifactPath, metadata: result.metadata });
      }
      if (source.input_kind === "text") {
        if (!source.raw_path) throw new Error("source 缺少 raw_path");
        const text = (await this.r2.getText(source.raw_path)).slice(0, LIMITS.maxTextExtractChars);
        return await this.db.createExtractionResult(source, "extracted", text, { metadata: { char_count: text.length } });
      }
      if (source.input_kind === "image") {
        if (!source.raw_path) throw new Error("source 缺少 raw_path");
        const object = await this.r2.getObject(source.raw_path);
        if (!object) throw new Error("R2 image object not found.");
        const dataUrl = `data:${source.mime_type || object.httpMetadata?.contentType || "image/png"};base64,${arrayBufferToBase64(await object.arrayBuffer())}`;
        const text = await this.openai.generateText("ocr", [{ role: "user", content: [{ type: "input_text", text: "Extract and summarize all readable Traditional Chinese text and important visual details from this image." }, { type: "input_image", image_url: dataUrl, detail: this.ctx.env.OPENAI_IMAGE_DETAIL_OCR || "high" }] }], "You extract OCR text and visual context for BrandDNA analysis. Return concise plain text only.");
        return await this.db.createExtractionResult(source, "extracted", text, { metadata: { char_count: text.length, ocr: true } });
      }
      if (source.input_kind === "file") {
        const ext = extensionOf(source.original_filename || source.raw_path || "");
        if (TEXT_EXTENSIONS.has(ext) && source.raw_path) {
          const text = (await this.r2.getText(source.raw_path)).slice(0, LIMITS.maxTextExtractChars);
          return await this.db.createExtractionResult(source, "extracted", text, { metadata: { char_count: text.length } });
        }
        if (DOCUMENT_EXTENSIONS.has(ext)) {
          return await this.db.createExtractionResult(source, "needs_manual_text", "", { error: "Cloudflare 展示版已保存檔案，但此文件格式請使用手動補資料貼上重點文字。", metadata: { r2_key: source.raw_path || "", fallback_required: true } });
        }
      }
      return await this.db.createExtractionResult(source, "needs_manual_text", "", { error: "此檔案格式請使用手動補資料。", metadata: { fallback_required: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return await this.db.createExtractionResult(source, "error", "", { error: message });
    }
  }

  async extractUrlText(source: SourceRow): Promise<{ extractedText: string; artifactPath: string | null; metadata: JsonRecord }> {
    const startUrl = source.url || "";
    if (!startUrl) throw new Error("URL source 缺少 url 欄位。");
    const crawlLimit = Math.min(URL_SOURCE_CONFIG[source.source_type]?.crawlLimit || 1, LIMITS.maxWebsitePages);
    const startedAt = Date.now();
    const visited: JsonValue[] = [];
    const texts: string[] = [];
    const pending = [startUrl];
    const seen = new Set<string>();
    while (pending.length && texts.length < crawlLimit && (Date.now() - startedAt) < LIMITS.maxWebsiteSeconds * 1000) {
      const current = pending.shift() || "";
      if (!current || seen.has(current)) continue;
      seen.add(current);
      const fetched = await fetchHtmlLimited(current);
      let html = fetched.html;
      let browserMeta: JsonRecord = {};
      if (stripHtml(html).length < 80) {
        const browser = await browserFetchHtml(this.ctx, current);
        if (browser.html) html = browser.html;
        browserMeta = browser.metadata;
      }
      const text = stripHtml(html).slice(0, LIMITS.maxTextExtractChars);
      visited.push({ url: current, status: text.length >= 20 ? "captured" : "low_text", char_count: text.length, fetch_status: fetched.status, ...browserMeta });
      if (text) texts.push(`## ${current}\n${extractTitle(html)}\n${text}`);
      if (source.source_type === "website" && texts.length < crawlLimit) {
        for (const next of candidateLinks(startUrl, current, html).slice(0, crawlLimit * 2)) {
          if (!seen.has(next) && !pending.includes(next)) pending.push(next);
        }
      }
    }
    if (!texts.length || texts.join("\n").length < 80) throw new Error("公開頁可讀文字不足，請改用手動輸入。");
    let artifactPath: string | null = null;
    const shot = await browserScreenshot(this.ctx, startUrl);
    if (shot.bytes) {
      const filename = `url_capture_${source.id}_${crypto.randomUUID().slice(0, 8)}.png`;
      artifactPath = await this.r2.putBytes(`artifacts/${source.brand_id}/url/${filename}`, shot.bytes, shot.contentType || "image/png");
    }
    return { extractedText: texts.join("\n\n").slice(0, LIMITS.maxTextExtractChars), artifactPath, metadata: { url: startUrl, crawl_limit: crawlLimit, visited_pages: visited, char_count: texts.join("\n").length } };
  }

  async analyzeSource(sourceId: number): Promise<JsonRecord> {
    const source = await this.db.source(sourceId);
    if (!source) throw new HttpError("找不到來源。", 404);
    let extraction = await this.db.latestExtraction(sourceId);
    if (!extraction || extraction.status !== "extracted") extraction = await this.extractSource(sourceId);
    if (String(extraction.status || "") !== "extracted") return await this.db.createAnalysisResult(source, "error", {}, String(extraction.error || "資料尚未完成擷取。"));
    try {
      const result = await this.openai.generateJson(
        "source_analysis",
        `Analyze this BrandDNA source for a Taiwanese restaurant brand.\nSource title: ${source.title || source.source_type}\nSource type: ${source.source_type}\nExtracted text:\n${String(extraction.extracted_text || "").slice(0, LIMITS.maxAnalysisChars)}\nReturn JSON with source_summary, archetype_signals, brand_role_evidence, keywords, tone_markers, visual_evidence, risks_or_gaps, content_opportunities.`,
        "You are a BrandDNA source analyst. Extract only evidence-backed signals from this single source. Use Traditional Chinese.",
        { temperature: 0.15 }
      );
      return await this.db.createAnalysisResult(source, "analyzed", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return await this.db.createAnalysisResult(source, "error", {}, message);
    }
  }

  async runSourcePipeline(brandId: number, jobId: number, specs: SourceSpec[], selectedRules: string[], internalRules: string): Promise<JsonRecord> {
    const created: JsonValue[] = [];
    const extracted: JsonValue[] = [];
    const analyzed: JsonValue[] = [];
    const errors: JsonValue[] = [];
    const sourceIds: number[] = [];
    for (const spec of specs) {
      const sourceId = await this.createSourceFromSpec(brandId, spec, jobId);
      sourceIds.push(sourceId);
      created.push({ id: sourceId, source_type: spec.source_type, url: spec.url || "", input_kind: spec.input_kind });
    }
    if (selectedRules.length) {
      const ruleId = await this.createTextSource(brandId, "compliance_rule", "店家選擇的法規規範", selectedRules.map((rule) => `- ${rule}`).join("\n"), null, { global_scan_id: jobId, automation: "selected_rules", selected_rules: selectedRules });
      sourceIds.push(ruleId);
      created.push({ id: ruleId, source_type: "compliance_rule", input_kind: "text" });
    }
    if (internalRules.trim()) {
      const ruleId = await this.createTextSource(brandId, "internal_rule", "店家內部規範", internalRules, null, { global_scan_id: jobId, automation: "internal_rule" });
      sourceIds.push(ruleId);
      created.push({ id: ruleId, source_type: "internal_rule", input_kind: "text" });
    }
    for (const sourceId of sourceIds) {
      const source = await this.db.source(sourceId);
      if (!source) continue;
      const extraction = await this.extractSource(sourceId);
      extracted.push({ source_id: sourceId, source_type: source.source_type, status: String(extraction.status || ""), error: String(extraction.error || "") });
      if (String(extraction.status || "") !== "extracted") {
        errors.push({ source_id: sourceId, stage: "extract", error: String(extraction.error || "") });
        continue;
      }
      const analysis = await this.analyzeSource(sourceId);
      analyzed.push({ source_id: sourceId, source_type: source.source_type, status: String(analysis.status || ""), error: String(analysis.error || "") });
      if (String(analysis.status || "") !== "analyzed") errors.push({ source_id: sourceId, stage: "analyze", error: String(analysis.error || "") });
    }
    if (!analyzed.some((item) => asRecord(item).status === "analyzed")) throw new HttpError("資料來源已建立，但智慧分析尚未完成。請確認 OPENAI_API_KEY 後再重試。", 424);
    const dna = await this.buildBrandDna(brandId);
    return { global_scan_id: jobId, created_sources: created, source_ids: sourceIds, extracted, analyzed, errors, brand_dna: dna };
  }

  async buildBrandDna(brandId: number, options: { force?: boolean } = {}): Promise<JsonRecord> {
    const rows = await this.db.all<JsonRecord>(
      `SELECT ar.*, rs.title, rs.source_type
       FROM analysis_results ar
       JOIN raw_sources rs ON rs.id = ar.source_id
       WHERE ar.brand_id = ? AND ar.status = 'analyzed'
       ORDER BY ar.id DESC`,
      [brandId]
    );
    if (!rows.length) throw new Error("目前沒有已分析的資料來源，請先完成來源分析。");
    const latestBySource = new Map<number, JsonRecord>();
    for (const row of rows) {
      const sourceId = Number(row.source_id || 0);
      if (sourceId && !latestBySource.has(sourceId)) latestBySource.set(sourceId, row);
    }
    const analyses = [...latestBySource.values()].map((row) => ({ analysis_id: Number(row.id || 0), source_id: Number(row.source_id || 0), source_type: String(row.source_type || ""), title: String(row.title || ""), result: parseJson(row.result_json, {}) }));
    const sourceResultIds = analyses.map((item) => Number(item.analysis_id || 0)).filter(Boolean);
    if (!options.force) {
      // Same analysed evidence as the active snapshot: reuse it instead of paying for an identical synthesis.
      const active = await this.db.activeBrandDna(brandId);
      const previous = asRecord(active?._snapshot).source_result_ids;
      if (active && Array.isArray(previous) && sameIdSet(previous, sourceResultIds)) {
        const reused = normalizeBrandDnaPayload(active);
        reused._snapshot_id = Number(asRecord(active._snapshot).id || 0);
        reused._reused = true;
        return reused;
      }
    }
    const result = await this.openai.generateJson(
      "brand_dna",
      `Synthesize these analyzed source results into Brand DNA using the 12 Brand Archetypes.\nAnalyzed source JSON:\n${toJson(analyses).slice(0, LIMITS.maxBrandDnaChars)}\n12 archetypes:\n${toJson(BRAND_ARCHETYPES)}\nReturn JSON with brand_name, handle, brand_archetype, archetype_scores, archetype_score_explanations, brand_character, positioning, brand_traits, visual_personality, keywords, forbidden_words, tone_guide, audience_segments, content_guidelines, summary.`,
      "You are a senior BrandDNA strategist. Synthesize evidence into a stable, practical Brand DNA. Use Traditional Chinese.",
      { temperature: 0.2 }
    );
    const normalized = normalizeBrandDnaPayload(result);
    const snapshotId = await this.db.saveBrandDna(brandId, normalized, {}, sourceResultIds);
    normalized._snapshot_id = snapshotId;
    return normalized;
  }

  async dashboardSummary(brandId: number): Promise<JsonRecord> {
    const sourceCount = Number((await this.db.first<{ c: number }>("SELECT COUNT(*) c FROM raw_sources WHERE brand_id = ?", [brandId]))?.c || 0);
    const extractedCount = Number((await this.db.first<{ c: number }>("SELECT COUNT(DISTINCT source_id) c FROM extraction_results WHERE brand_id = ? AND status = 'extracted'", [brandId]))?.c || 0);
    const analysisCount = Number((await this.db.first<{ c: number }>("SELECT COUNT(DISTINCT source_id) c FROM analysis_results WHERE brand_id = ? AND status = 'analyzed'", [brandId]))?.c || 0);
    const artifactCount = Number((await this.db.first<{ c: number }>("SELECT COUNT(*) c FROM artifacts WHERE brand_id = ?", [brandId]))?.c || 0);
    const statusRows = await this.db.all<{ status: string; c: number }>("SELECT status, COUNT(*) c FROM raw_sources WHERE brand_id = ? GROUP BY status", [brandId]);
    const dna = await this.db.activeBrandDna(brandId);
    const sourcesByStatus: JsonRecord = {};
    for (const row of statusRows) sourcesByStatus[row.status] = Number(row.c || 0);
    return { brand_dna_configured: Boolean(dna), data_sources_count: sourceCount, extracted_count: extractedCount, analyses_count: analysisCount, generated_content_count: artifactCount, sources_by_status: sourcesByStatus, brand_dna: dna ? normalizeBrandDnaPayload(dna) : null };
  }

  async serializeSource(source: SourceRow): Promise<JsonRecord> {
    const metadata = parseJson<JsonRecord>(source.metadata_json, {});
    const extraction = await this.db.latestExtraction(source.id);
    const analysis = await this.db.latestAnalysis(source.id);
    const out: JsonRecord = { ...source, metadata };
    delete out.metadata_json;
    if (extraction) {
      const latest: JsonRecord = { ...extraction, metadata: parseJson(extraction.metadata_json, {}) };
      delete latest.metadata_json;
      out.latest_extraction = latest;
    } else {
      out.latest_extraction = null;
    }
    if (analysis) {
      const latest: JsonRecord = { ...analysis, result: parseJson(analysis.result_json, {}) };
      delete latest.result_json;
      out.latest_analysis = latest;
    } else {
      out.latest_analysis = null;
    }
    return out;
  }

  async latestArtifacts(brandId: number, limit: number, artifactType?: string): Promise<JsonRecord[]> {
    const rows = artifactType
      ? await this.db.all<JsonRecord>("SELECT * FROM artifacts WHERE brand_id = ? AND artifact_type = ? ORDER BY id DESC LIMIT ?", [brandId, artifactType, limit])
      : await this.db.all<JsonRecord>("SELECT * FROM artifacts WHERE brand_id = ? ORDER BY id DESC LIMIT ?", [brandId, limit]);
    return rows.map((row) => serializeArtifact(row));
  }

  async latestAnalyzedPayloads(brandId: number, limit: number): Promise<JsonRecord[]> {
    const rows = await this.db.all<JsonRecord>(
      `SELECT ar.*, rs.source_type, rs.title
       FROM analysis_results ar
       JOIN raw_sources rs ON rs.id = ar.source_id
       WHERE ar.brand_id = ? AND ar.status = 'analyzed'
       ORDER BY ar.id DESC LIMIT ?`,
      [brandId, limit]
    );
    return rows.map((row) => ({ source_type: String(row.source_type || ""), title: String(row.title || ""), result: parseJson(row.result_json, {}) }));
  }

  async fetchLogs(options: { brandId?: number; jobId?: number; sourceId?: number; level?: string | null; eventType?: string | null; limit?: number }): Promise<JsonRecord[]> {
    const clauses: string[] = [];
    const values: (string | number | null)[] = [];
    if (options.brandId) { clauses.push("(brand_id = ? OR brand_id IS NULL)"); values.push(options.brandId); }
    if (options.jobId) { clauses.push("job_id = ?"); values.push(options.jobId); }
    if (options.sourceId) { clauses.push("source_id = ?"); values.push(options.sourceId); }
    if (options.level) { clauses.push("level = ?"); values.push(options.level); }
    if (options.eventType) { clauses.push("event_type = ?"); values.push(options.eventType); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
    const rows = await this.db.all<JsonRecord>(`SELECT * FROM system_logs ${where} ORDER BY id DESC LIMIT ?`, [...values, limit]);
    return rows.map((row): JsonRecord => {
      const out: JsonRecord = { ...row, details: parseJson(row.details_json, {}) };
      delete out.details_json;
      return out;
    });
  }

  async linkConceptImage(contentArtifactId: number, imageArtifactId: number, imagePayload: JsonRecord): Promise<void> {
    const row = await this.db.artifactById(contentArtifactId);
    if (!row || row.artifact_type !== "content_generation") return;
    const payload = parseJson<JsonRecord>(row.payload_json, {});
    payload.concept_image = { artifact_id: imageArtifactId, file_url: imagePayload.file_url || "", prompt: imagePayload.prompt || "", size: imagePayload.size || "", image_path: imagePayload.image_path || "" };
    await this.db.updateArtifactPayload(contentArtifactId, payload);
  }
}

function aggregateUsage(items: readonly { calls?: number; input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_tokens: number; total_tokens: number; cost_usd: number | null; model?: string }[]): JsonRecord {
  const knownCosts = items.filter((item) => typeof item.cost_usd === "number");
  return {
    calls: items.length,
    input_tokens: items.reduce((sum, item) => sum + item.input_tokens, 0),
    cached_input_tokens: items.reduce((sum, item) => sum + item.cached_input_tokens, 0),
    output_tokens: items.reduce((sum, item) => sum + item.output_tokens, 0),
    reasoning_tokens: items.reduce((sum, item) => sum + item.reasoning_tokens, 0),
    total_tokens: items.reduce((sum, item) => sum + item.total_tokens, 0),
    cost_usd: knownCosts.length === items.length ? knownCosts.reduce((sum, item) => sum + Number(item.cost_usd || 0), 0) : null,
    currency: "USD",
    pricing_note: "Cloudflare demo records OpenAI response usage; cost is null when model pricing is unknown.",
    items: items as unknown as JsonValue
  };
}

function normalizeUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchHtmlLimited(url: string): Promise<{ html: string; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "BrandDNA Cloudflare Demo crawler (+limited fetch)" }
    });
    const reader = response.body?.getReader();
    if (!reader) return { html: "", status: response.status };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < LIMITS.maxHtmlBytes) {
      const read = await reader.read();
      if (read.done) break;
      chunks.push(read.value);
      total += read.value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    const bytes = new Uint8Array(Math.min(total, LIMITS.maxHtmlBytes));
    let offset = 0;
    for (const chunk of chunks) {
      const slice = chunk.slice(0, Math.max(0, LIMITS.maxHtmlBytes - offset));
      bytes.set(slice, offset);
      offset += slice.byteLength;
      if (offset >= LIMITS.maxHtmlBytes) break;
    }
    return { html: new TextDecoder("utf-8", { fatal: false }).decode(bytes), status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]?.trim() || "";
  return [title ? `Title: ${title}` : "", desc ? `Description: ${desc}` : ""].filter(Boolean).join("\n");
}

function candidateLinks(siteUrl: string, currentUrl: string, html: string): string[] {
  const out: string[] = [];
  const site = new URL(siteUrl);
  const hrefs = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+)["']/gi)].map((match) => match[1] || "");
  for (const href of hrefs) {
    try {
      const url = new URL(href, currentUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (url.hostname.replace(/^www\./, "") !== site.hostname.replace(/^www\./, "")) continue;
      url.hash = "";
      const ext = extensionOf(url.pathname);
      if (DOCUMENT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) continue;
      const normalized = url.toString();
      if (!out.includes(normalized) && normalized !== currentUrl) out.push(normalized);
    } catch {
      continue;
    }
  }
  return out;
}

function autoSocialPayload(sourceType: string, form: FormData): { content: string; metadata: JsonRecord } | null {
  const contents: string[] = [];
  for (let i = 1; i <= LIMITS.socialPostCount; i += 1) contents.push(String(form.get(`${sourceType}_auto_post_content_${i}`) || "").trim());
  if (!contents.some(Boolean)) return null;
  if (!contents.every(Boolean)) throw new HttpError(`${sourceTypeLabel(sourceType)} 自動擷取貼文尚未完整，請補滿 5 篇或改用手動輸入。`, 400);
  return {
    content: [`${sourceTypeLabel(sourceType)} 自動擷取貼文，共 ${LIMITS.socialPostCount} 篇`, ...contents.map((content, index) => `## Post ${index + 1}\n${content}`)].join("\n\n"),
    metadata: { auto_social_posts: contents.map((_content, index) => ({ index: index + 1, source: "auto_preview" })), auto_post_count: LIMITS.socialPostCount }
  };
}

function collectSpecsFromJson(payload: JsonRecord): SourceSpec[] {
  if (Array.isArray(payload.source_specs)) return payload.source_specs.map((item) => asRecord(item)).map((item) => ({ source_type: String(item.source_type || "custom"), input_kind: String(item.input_kind || "url") === "text" ? "text" : "url", url: normalizeUrl(item.url), title: String(item.title || "") || null, content: String(item.content || ""), metadata: asRecord(item.metadata) }));
  const urls = asRecord(payload.urls);
  const specs: SourceSpec[] = [];
  for (const sourceType of GLOBAL_SCAN_SOURCE_TYPES) {
    const url = normalizeUrl(urls[sourceType]);
    if (url) specs.push({ source_type: sourceType, input_kind: "url", url, title: `${sourceTypeLabel(sourceType)} URL 擷取`, metadata: { source_input_mode: "url" } });
  }
  return specs;
}

function splitSocialPosts(text: string, sourceType: string): JsonRecord[] {
  const blocks = text.split(/\n(?=##\s+)/g).map((block) => block.trim()).filter(Boolean);
  const posts = blocks.slice(0, LIMITS.socialPostCount).map((block, index) => ({ index: index + 1, content: block.replace(/^##[^\n]*\n?/, "").trim(), source_url: block.match(/^##\s+([^\n]+)/)?.[1] || "", source_type: sourceType }));
  return posts.filter((post) => post.content.length > 20);
}

function serializeArtifact(row: JsonRecord): JsonRecord {
  const payload = parseJson<JsonRecord>(row.payload_json, {});
  const summary = String(payload.final_caption || payload.personality_narrative || payload.summary || payload.safe_content || row.title || "").slice(0, 160);
  const fileUrl = String(payload.file_url || publicArtifactUrl(String(row.file_path || "")) || "");
  const out: JsonRecord = { ...row, payload, summary, file_url: fileUrl };
  delete out.payload_json;
  return out;
}

function overviewTodos(summary: JsonRecord, artifacts: JsonRecord[]): JsonValue[] {
  const artifactTypes = new Set(artifacts.map((item) => String(item.artifact_type || "")));
  const todos: JsonValue[] = [];
  if (!Number(summary.data_sources_count || 0)) todos.push({ level: "attention", text: "尚未匯入資料來源，請先新增品牌資料。", href: "/data-hub" });
  if (Number(summary.data_sources_count || 0) && Number(summary.extracted_count || 0) < Number(summary.data_sources_count || 0)) todos.push({ level: "attention", text: "部分資料尚未完成擷取，請回資料中心處理。", href: "/data-hub" });
  if (Number(summary.extracted_count || 0) && Number(summary.analyses_count || 0) < Number(summary.extracted_count || 0)) todos.push({ level: "attention", text: "部分資料尚未完成 AI 分析。", href: "/data-hub" });
  if (!summary.brand_dna_configured) todos.push({ level: "urgent", text: "尚未建立品牌角色，請先完成診斷。", href: "/diagnosis" });
  if (summary.brand_dna_configured && !artifactTypes.has("content_generation")) todos.push({ level: "info", text: "可以產生第一組品牌內容。", href: "/generate" });
  if (!todos.length) todos.push({ level: "success", text: "目前資料與分析狀態正常。", href: "/diagnosis" });
  return todos;
}

function normalizeDiagnosis(result: JsonRecord, summary: JsonRecord, dna: JsonRecord): JsonRecord {
  const normalizedDna = normalizeBrandDnaPayload(dna);
  const globalScan = asRecord(result.global_scan);
  const brandCharacter = asRecord(normalizedDna.brand_character);
  const resultCharacter = asRecord(result.character);
  return {
    global_scan: globalScan.readiness_score ? globalScan : { total_sources: summary.data_sources_count || 0, extracted_count: summary.extracted_count || 0, analyzed_count: summary.analyses_count || 0, readiness_score: Number(summary.data_sources_count || 0) ? Math.round(Number(summary.analyses_count || 0) / Math.max(Number(summary.data_sources_count || 1), 1) * 100) : 0, notes: [] },
    archetype_position: result.archetype_position || { primary_archetype: asRecord(normalizedDna.brand_archetype).role_name || "凡人型品牌", confidence: asRecord(normalizedDna.brand_archetype).confidence || 80, dimensions: Object.entries(asRecord(normalizedDna.archetype_scores)).map(([key, score], index) => ({ key, name: BRAND_ARCHETYPES[key]?.role_name || key, score: clampScore(score), rank: index + 1 })).slice(0, 12), rationale: asRecord(normalizedDna.brand_archetype).rationale || "" },
    brand_positioning: result.brand_positioning || brandCharacter.positioning || "",
    brand_traits: Array.isArray(result.brand_traits) ? result.brand_traits : brandCharacter.traits || [],
    brand_voice: result.brand_voice || brandCharacter.voice || "",
    target_audience: result.target_audience || brandCharacter.target_audience || "",
    character: Object.keys(resultCharacter).length ? resultCharacter : brandCharacter,
    generation_settings: result.generation_settings || { copy_tone: brandCharacter.voice || "", image_direction: brandCharacter.visual_personality || "", audience: brandCharacter.target_audience || "" }
  };
}

function normalizeSuggestions(result: JsonRecord, brand: JsonRecord, dna: JsonRecord): { label: string; text: string }[] {
  const raw = Array.isArray(result.suggestions) ? result.suggestions : [];
  const out = raw.map((item) => asRecord(item)).map((item) => ({ label: String(item.label || item.title || "").slice(0, 24), text: String(item.text || item.request || item.prompt || "").slice(0, 220) })).filter((item) => item.text);
  const category = String(brand.category || DEFAULT_BRAND.category);
  const character = asRecord(dna.brand_character);
  const audience = String(character.target_audience || "主要客群");
  const fallback = [
    { label: "招牌品項情境", text: `請幫我寫一則適合 Instagram 的${category}招牌品項情境貼文，讓${audience}看了想收藏或到店。` },
    { label: "尖峰外帶提醒", text: "請幫我寫一則尖峰時段外帶或預訂提醒貼文，語氣符合品牌角色。" },
    { label: "熟客日常互動", text: `請幫我寫一則日常互動型社群貼文，延續${category}的店家個性。` }
  ];
  return [...out, ...fallback].slice(0, 3);
}

function normalizeContentPlatform(value: unknown): "instagram" | "facebook" | null {
  const raw = String(value || "instagram").toLowerCase();
  if (["instagram", "instagram_post", "ig"].includes(raw)) return "instagram";
  if (["facebook", "facebook_post", "fb"].includes(raw)) return "facebook";
  return null;
}

function complianceSettings(payload: JsonRecord, dna: JsonRecord): JsonRecord {
  const forbidden = new Set<string>();
  for (const source of [dna.forbidden_words, payload.forbidden_words]) {
    if (Array.isArray(source)) source.map(String).filter(Boolean).forEach((item) => forbidden.add(item));
  }
  return { legal_rules: payload.legal_rules || payload.selected_rules || [], forbidden_words: [...forbidden], internal_rules: String(payload.internal_rules || ""), marketing_rules: String(payload.marketing_rules || ""), custom_rules: payload.custom_rules || [] };
}

function normalizeContentResult(result: JsonRecord, platform: "instagram" | "facebook", dna: JsonRecord, compliance: JsonRecord, context: string): JsonRecord {
  const generated = Array.isArray(result.generated_content) ? result.generated_content.map(String).filter(Boolean) : [];
  const finalCaption = String(result.final_caption || generated[0] || "");
  if (finalCaption && !generated.includes(finalCaption)) generated.unshift(finalCaption);
  return {
    ...result,
    platform: platform === "instagram" ? "Instagram" : "Facebook",
    final_caption: generated[0] || finalCaption,
    generated_content: generated.length ? generated : [finalCaption || context],
    brand_character: asRecord(dna.brand_character),
    target_audience: String(result.target_audience || asRecord(dna.brand_character).target_audience || ""),
    compliance_settings: compliance,
    image_prompt: String(result.image_prompt || socialPostImagePrompt(platform, context, finalCaption, dna, compliance)),
    compliance_notes: Array.isArray(result.compliance_notes) ? result.compliance_notes : ["已依規範設定生成最終版本。"]
  };
}

function socialPostImagePrompt(platform: string, context: string, caption: string, dna: JsonRecord, compliance: JsonRecord): string {
  const character = asRecord(dna.brand_character);
  return [
    "Create one square, photorealistic, text-free social post concept image for a Taiwanese restaurant brand.",
    `Platform: ${platform}.`,
    `Marketing request/theme: ${context}`,
    `Final caption this image must support: ${caption}`,
    `Brand character: ${String(character.name || "")}; positioning: ${String(character.positioning || "")}; target audience: ${String(character.target_audience || "")}.`,
    `Forbidden terms/claims: ${Array.isArray(compliance.forbidden_words) ? compliance.forbidden_words.join(", ") : ""}.`,
    "Show clear food, ingredients, serving context, and warm breakfast-shop atmosphere. No readable text, logos, real people, celebrities, medical claims, or exaggerated promises."
  ].join("\n");
}

function brandSafeImagePrompt(prompt: string): string {
  return `Draw a brand-safe restaurant social post concept image from this prompt.\n\n${prompt}\n\nRules: suitable for public restaurant marketing; no readable text, logos, real people, celebrities, copyrighted characters, medical claims, legal claims, or exaggerated promises.`;
}

function characterImagePromptInput(dna: JsonRecord): JsonRecord {
  const normalized = normalizeBrandDnaPayload(dna);
  return { brand_name: normalized.brand_name || DEFAULT_BRAND.name, summary: normalized.summary || "", primary_archetype: asRecord(normalized.brand_archetype), top_archetypes: Object.entries(asRecord(normalized.archetype_scores)).sort((a, b) => clampScore(b[1]) - clampScore(a[1])).slice(0, 5).map(([key, score]) => ({ key, name: BRAND_ARCHETYPES[key]?.role_name || key, score: clampScore(score), description: BRAND_ARCHETYPES[key]?.description || "" })), ...asRecord(normalized.brand_character), keywords: normalized.keywords || [], forbidden_words: normalized.forbidden_words || [] };
}

function normalizeCharacterPrompt(result: JsonRecord, input: JsonRecord): JsonRecord {
  const prompt = String(result.english_prompt || `Full-body brand ambassador character portrait, vertical composition, 3/4 view, complete body visible. Brand: ${String(input.brand_name || DEFAULT_BRAND.name)}. No readable text, no logos, no real people, no copyrighted characters.`);
  return { english_prompt: prompt.includes("complete body visible") ? prompt : `${prompt}\nMandatory generation constraints: full-body character, complete body visible, 3/4 view, no cropping, no readable text, no logos, no real people, no celebrities, no copyrighted characters.`, prompt_preview_zh: String(result.prompt_preview_zh || "以品牌主原型、定位、特色與視覺個性生成完整角色圖。"), used_inputs: asRecord(result.used_inputs || input), style_keywords: Array.isArray(result.style_keywords) ? result.style_keywords.slice(0, 12) : ["full-body character", "brand ambassador", "restaurant brand"] };
}

function brandDnaPromptBlock(dna: JsonRecord): string {
  const normalized = normalizeBrandDnaPayload(dna);
  return `Summary: ${String(normalized.summary || "")}\nPrimary archetype: ${String(asRecord(normalized.brand_archetype).role_name || "")}\nBrand character: ${toJson(normalized.brand_character)}\nKeywords: ${Array.isArray(normalized.keywords) ? normalized.keywords.join(", ") : ""}\nForbidden words: ${Array.isArray(normalized.forbidden_words) ? normalized.forbidden_words.join(", ") : ""}\nTone guide: ${toJson(normalized.tone_guide)}`;
}

function normalizeSimulation(result: JsonRecord, audiences: string[]): JsonRecord {
  const rows = simulationRows(result);
  if (!rows.length) {
    throw new HttpError("市場預測模型回傳缺少 audience_predictions，未產生可信的客群分數。請重試。", 502, { model_result: result });
  }
  const predictions = rows.map((row, index) => {
    const score = simulationScore(row);
    if (score === null) {
      throw new HttpError(`市場預測模型回傳的第 ${index + 1} 個客群缺少有效分數，未產生可信的客群分數。請重試。`, 502, { model_result: result });
    }
    const audience = String(row.audience || row.persona || row.segment || row.name || audiences[index] || "目標客群");
    return {
      audience,
      acceptance_score: score,
      attraction_reason: String(row.attraction_reason || row.reason || row.reaction || row.fit_reason || "對內容主題與品牌語氣有正向接受度。"),
      positive_response: String(row.positive_response || row.expected_response || row.response || row.reaction || "可能願意留意貼文並進一步互動。")
    };
  });
  if (predictions.length < audiences.length) {
    throw new HttpError("市場預測模型回傳的客群數量不足，未產生完整預測。請重試。", 502, { expected: audiences.length, actual: predictions.length, model_result: result });
  }
  const top = [...predictions].sort((a, b) => b.acceptance_score - a.acceptance_score).slice(0, 2).map((row, index) => ({ rank: index + 1, audience: row.audience, reason: row.attraction_reason }));
  const average = Math.round(predictions.reduce((sum, row) => sum + row.acceptance_score, 0) / Math.max(predictions.length, 1));
  return { overall_score: scoreFromValue(result.overall_score) ?? average, audience_predictions: predictions, top_segments: top };
}

function simulationRows(result: JsonRecord): JsonRecord[] {
  for (const value of [
    result.audience_predictions,
    result.persona_results,
    result.predictions,
    result.segment_predictions,
    result.segments,
    result.audiences
  ]) {
    if (Array.isArray(value)) {
      const rows = value.map((item) => asRecord(item)).filter((item) => Object.keys(item).length);
      if (rows.length) return rows;
    }
  }
  return [];
}

function simulationScore(row: JsonRecord): number | null {
  for (const key of [
    "acceptance_score",
    "score",
    "positive_acceptance",
    "acceptance",
    "acceptance_rate",
    "acceptance_percentage",
    "predicted_acceptance",
    "positive_score",
    "fit_score"
  ]) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      const score = scoreFromValue(row[key]);
      if (score !== null) return score;
    }
  }
  return null;
}

function scoreFromValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  const fraction = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(10|100)$/);
  if (fraction) {
    const number = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return Number.isFinite(number) && Number.isFinite(denominator) ? clampScore((number / denominator) * 100) : null;
  }
  const parsed = typeof value === "number" ? value : Number(raw.replace(/%/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return clampScore(parsed > 0 && parsed <= 10 && !raw.includes("%") ? parsed * 10 : parsed);
}

function stripUndefined(value: JsonRecord): JsonRecord {
  const out: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = item as JsonValue;
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

const DEMO_SOURCES: Record<string, { title: string; content: string }> = {
  website: {
    title: "官網 / 品牌頁資料",
    content: "沒事早事坐是一間台北台式早午餐品牌，主打蛋餅、吐司、奶茶與熟客日常。品牌語氣親切、像鄰居一樣，強調快速、溫暖、穩定的早餐體驗。店面視覺明亮乾淨，常用暖色系與手作餐點照片。"
  },
  facebook: {
    title: "Facebook 貼文與公告",
    content: "Facebook 內容多用於營業時間提醒、熱門品項公告與熟客互動。常見語氣是直接、親切、帶有生活感，例如提醒尖峰時段可以先電話預訂，或介紹當日備料與推薦餐點。"
  },
  google_reviews: {
    title: "Google 評論 / 顧客回饋",
    content: "顧客評論提到蛋餅酥香、奶茶順口、老闆親切、出餐速度穩定。部分回饋希望尖峰時段排隊資訊更清楚。整體印象是日常、可信、在地熟悉。"
  },
  recruitment: {
    title: "招募資訊摘要",
    content: "招募資訊強調團隊互助、乾淨流程、穩定出餐與親切服務。期待夥伴能記得熟客偏好、保持環境整潔，並在早晨尖峰維持節奏。"
  }
};
