import {
  AppContext,
  DbRow,
  JsonRecord,
  PLAN_CONFIG,
  SourceRow,
  compactLogValue,
  currentWeekStart,
  normalizePlan,
  parseJson,
  toJson,
  utcNow
} from "../schema";

type BindValue = string | number | null;

export class D1Adapter {
  readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async first<T extends DbRow>(sql: string, values: BindValue[] = []): Promise<T | null> {
    const stmt = this.ctx.env.DB.prepare(sql).bind(...values);
    return await stmt.first<T>();
  }

  async all<T extends DbRow>(sql: string, values: BindValue[] = []): Promise<T[]> {
    const stmt = this.ctx.env.DB.prepare(sql).bind(...values);
    const result = await stmt.all<T>();
    return result.results || [];
  }

  async run(sql: string, values: BindValue[] = []): Promise<D1Result<unknown>> {
    return await this.ctx.env.DB.prepare(sql).bind(...values).run();
  }

  async insert(sql: string, values: BindValue[] = []): Promise<number> {
    const result = await this.run(sql, values);
    const id = result.meta.last_row_id;
    return typeof id === "number" ? id : Number(id || 0);
  }

  async defaultBrandId(): Promise<number> {
    const row = await this.first<{ id: number }>("SELECT id FROM brands WHERE handle = ?", ["zao_shih"]);
    if (row) return Number(row.id);
    const now = utcNow();
    return await this.insert(
      `INSERT INTO brands (handle, name, category, location, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["zao_shih", "沒事早事坐", "台式早午餐", "台北市", "示範用餐飲品牌，用於 BrandDNA Cloudflare Demo。", now, now]
    );
  }

  async brand(): Promise<JsonRecord | null> {
    const brandId = await this.defaultBrandId();
    return await this.first<JsonRecord>("SELECT * FROM brands WHERE id = ?", [brandId]);
  }

  async weeklyUsageCounts(brandId?: number): Promise<Record<string, number>> {
    const id = brandId || await this.defaultBrandId();
    const rows = await this.all<{ feature: string; used: number }>(
      `SELECT feature, COALESCE(SUM(units), 0) AS used
       FROM usage_events
       WHERE run_id = ? AND brand_id = ? AND period_start = ?
       GROUP BY feature`,
      [this.ctx.state.runId, id, currentWeekStart()]
    );
    const out: Record<string, number> = {};
    for (const row of rows) out[String(row.feature)] = Number(row.used || 0);
    return out;
  }

  async totalWeeklyUsage(brandId?: number): Promise<number> {
    const id = brandId || await this.defaultBrandId();
    const row = await this.first<{ used: number }>(
      `SELECT COALESCE(SUM(units), 0) AS used
       FROM usage_events
       WHERE brand_id = ? AND period_start = ?`,
      [id, currentWeekStart()]
    );
    return Number(row?.used || 0);
  }

  /** This week's OpenAI spend, summed from the per-call cost_usd recorded with every openai_usage event. */
  async weeklyAiCostUsd(brandId?: number): Promise<number> {
    const id = brandId || await this.defaultBrandId();
    const row = await this.first<{ cost: number }>(
      `SELECT COALESCE(SUM(json_extract(item.value, '$.cost_usd')), 0) AS cost
       FROM usage_events, json_each(usage_events.metadata_json, '$.items') AS item
       WHERE usage_events.feature = 'openai_usage' AND usage_events.brand_id = ? AND usage_events.period_start = ?`,
      [id, currentWeekStart()]
    );
    return Number(row?.cost || 0);
  }

  async subscriptionPayload(brandId?: number): Promise<JsonRecord> {
    const id = brandId || await this.defaultBrandId();
    const plan = normalizePlan(this.ctx.state.plan);
    const config = PLAN_CONFIG[plan];
    const used = await this.weeklyUsageCounts(id);
    const quotas: JsonRecord = {};
    for (const [feature, limit] of Object.entries(config.quotas)) {
      const count = used[feature] || 0;
      quotas[feature] = {
        limit,
        used: count,
        remaining: limit === null ? null : Math.max(0, Number(limit) - count)
      };
    }
    return {
      plan,
      plan_info: { name: config.name, price: config.price, features: config.features },
      period: { type: "session", run_id: this.ctx.state.runId, week_start: currentWeekStart() },
      quotas,
      usage: used,
      plans: PLAN_CONFIG
    };
  }

  async recordUsageEvent(feature: string, units = 1, metadata: JsonRecord = {}): Promise<void> {
    const brandId = await this.defaultBrandId();
    await this.run(
      `INSERT INTO usage_events
       (run_id, brand_id, feature, plan, units, period_start, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [this.ctx.state.runId, brandId, feature, normalizePlan(this.ctx.state.plan), units, currentWeekStart(), toJson(metadata), utcNow()]
    );
  }

  async logEvent(options: {
    level: string;
    eventType: string;
    message: string;
    brandId?: number | null;
    jobId?: number | null;
    sourceId?: number | null;
    stage?: string | null;
    details?: unknown;
    durationMs?: number | null;
    error?: string | null;
  }): Promise<void> {
    const createdAt = utcNow();
    const details = compactLogValue(options.details || {});
    await this.run(
      `INSERT INTO system_logs
       (brand_id, job_id, source_id, request_id, level, event_type, stage, message, details_json, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.brandId ?? null,
        options.jobId ?? null,
        options.sourceId ?? null,
        this.ctx.state.requestId,
        options.level,
        options.eventType,
        options.stage ?? null,
        options.message,
        toJson(details),
        options.durationMs ?? null,
        options.error ?? null,
        createdAt
      ]
    );
    // D1 already holds the complete event. Do not duplicate every log into object storage.
  }

  async createSource(source: {
    brandId: number;
    sourceType: string;
    inputKind: string;
    title?: string | null;
    url?: string | null;
    originalFilename?: string | null;
    rawPath?: string | null;
    mimeType?: string | null;
    status?: string;
    metadata?: JsonRecord;
  }): Promise<number> {
    const now = utcNow();
    const sourceId = await this.insert(
      `INSERT INTO raw_sources
       (brand_id, source_type, input_kind, title, url, original_filename, raw_path, mime_type, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        source.brandId,
        source.sourceType,
        source.inputKind,
        source.title ?? null,
        source.url ?? null,
        source.originalFilename ?? null,
        source.rawPath ?? null,
        source.mimeType ?? null,
        source.status || "stored",
        toJson(source.metadata || {}),
        now,
        now
      ]
    );
    await this.logEvent({
      level: "info",
      eventType: "source.created",
      message: `Created ${source.sourceType} source #${sourceId}.`,
      brandId: source.brandId,
      sourceId,
      stage: "source",
      details: { source_type: source.sourceType, input_kind: source.inputKind, title: source.title, url: source.url }
    });
    return sourceId;
  }

  async source(sourceId: number): Promise<SourceRow | null> {
    return await this.first<SourceRow>("SELECT * FROM raw_sources WHERE id = ?", [sourceId]);
  }

  async updateSourceStatus(sourceId: number, status: string): Promise<void> {
    await this.run("UPDATE raw_sources SET status = ?, updated_at = ? WHERE id = ?", [status, utcNow(), sourceId]);
  }

  async createExtractionResult(source: SourceRow, status: string, extractedText = "", options: { artifactPath?: string | null; error?: string | null; metadata?: JsonRecord } = {}): Promise<JsonRecord> {
    const id = await this.insert(
      `INSERT INTO extraction_results
       (source_id, brand_id, status, extracted_text, artifact_path, error, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [source.id, source.brand_id, status, extractedText, options.artifactPath ?? null, options.error ?? null, toJson(options.metadata || {}), utcNow()]
    );
    await this.updateSourceStatus(source.id, status);
    await this.logEvent({
      level: status === "extracted" ? "info" : status === "needs_manual_text" ? "warning" : "error",
      eventType: status === "extracted" ? "extract.completed" : "extract.failed",
      message: `Extraction ${status} for source #${source.id}.`,
      brandId: source.brand_id,
      sourceId: source.id,
      stage: "extract",
      details: { status, source_type: source.source_type, input_kind: source.input_kind, char_count: extractedText.length, artifact_path: options.artifactPath, metadata: options.metadata || {} },
      error: options.error ?? null
    });
    return { id, source_id: source.id, status, extracted_text: extractedText, artifact_path: options.artifactPath || null, error: options.error || null, metadata: options.metadata || {} };
  }

  async createAnalysisResult(source: SourceRow, status: string, result: JsonRecord = {}, error?: string | null): Promise<JsonRecord> {
    const id = await this.insert(
      `INSERT INTO analysis_results
       (source_id, brand_id, analysis_type, status, result_json, error, created_at)
       VALUES (?, ?, 'personality', ?, ?, ?, ?)`,
      [source.id, source.brand_id, status, toJson(result), error ?? null, utcNow()]
    );
    await this.logEvent({
      level: status === "analyzed" ? "info" : "error",
      eventType: status === "analyzed" ? "analyze.completed" : "analyze.failed",
      message: `Analysis ${status} for source #${source.id}.`,
      brandId: source.brand_id,
      sourceId: source.id,
      stage: "analyze",
      details: { status, source_type: source.source_type, result_keys: Object.keys(result).sort() },
      error: error ?? null
    });
    return { id, source_id: source.id, status, result, error: error || null };
  }

  async latestExtraction(sourceId: number): Promise<JsonRecord | null> {
    return await this.first<JsonRecord>("SELECT * FROM extraction_results WHERE source_id = ? ORDER BY id DESC LIMIT 1", [sourceId]);
  }

  async latestAnalysis(sourceId: number): Promise<JsonRecord | null> {
    return await this.first<JsonRecord>("SELECT * FROM analysis_results WHERE source_id = ? ORDER BY id DESC LIMIT 1", [sourceId]);
  }

  async createJob(brandId: number, jobType: string, input: JsonRecord): Promise<number> {
    const id = await this.insert(
      "INSERT INTO jobs (brand_id, job_type, status, input_json, created_at) VALUES (?, ?, 'queued', ?, ?)",
      [brandId, jobType, toJson(input), utcNow()]
    );
    await this.logEvent({ level: "info", eventType: "job.created", message: `Created ${jobType} job #${id}.`, brandId, jobId: id, stage: "job", details: { job_type: jobType, input } });
    return id;
  }

  async updateJob(jobId: number, status: string, options: { result?: JsonRecord | null; error?: string | null; markStarted?: boolean; markFinished?: boolean } = {}): Promise<void> {
    const fields = ["status = ?", "result_json = ?", "error = ?"];
    const values: BindValue[] = [status, options.result !== undefined ? toJson(options.result) : null, options.error ?? null];
    if (options.markStarted) {
      fields.push("started_at = COALESCE(started_at, ?)");
      values.push(utcNow());
    }
    if (options.markFinished) {
      fields.push("finished_at = ?");
      values.push(utcNow());
    }
    values.push(jobId);
    await this.run(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`, values);
    const job = await this.fetchJob(jobId);
    await this.logEvent({ level: status === "error" ? "error" : "info", eventType: "job.status_changed", message: `Job #${jobId} changed to ${status}.`, brandId: Number(job?.brand_id || 0) || null, jobId, stage: "job", details: { status, job_type: job?.job_type || null, has_result: options.result !== undefined }, error: options.error ?? null });
  }

  async fetchJob(jobId: number): Promise<JsonRecord | null> {
    const row = await this.first<JsonRecord>("SELECT * FROM jobs WHERE id = ?", [jobId]);
    if (!row) return null;
    const out = { ...row };
    out.input = parseJson(out.input_json, {});
    out.result = parseJson(out.result_json, null);
    delete out.input_json;
    delete out.result_json;
    return out;
  }

  async saveBrandDna(brandId: number, result: JsonRecord, manualOverrides: JsonRecord = {}, sourceResultIds: number[] = []): Promise<number> {
    await this.run("UPDATE brand_dna_snapshots SET active = 0 WHERE brand_id = ?", [brandId]);
    return await this.insert(
      `INSERT INTO brand_dna_snapshots
       (brand_id, result_json, manual_overrides_json, source_result_ids_json, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [brandId, toJson(result), toJson(manualOverrides), toJson(sourceResultIds), utcNow()]
    );
  }

  async activeBrandDna(brandId?: number): Promise<JsonRecord | null> {
    const id = brandId || await this.defaultBrandId();
    const row = await this.first<JsonRecord>(
      "SELECT * FROM brand_dna_snapshots WHERE brand_id = ? AND active = 1 ORDER BY id DESC LIMIT 1",
      [id]
    );
    if (!row) return null;
    const result = parseJson<JsonRecord>(row.result_json, {});
    result._snapshot = {
      id: Number(row.id),
      created_at: String(row.created_at || ""),
      manual_overrides: parseJson(row.manual_overrides_json, {}),
      source_result_ids: parseJson(row.source_result_ids_json, [])
    };
    return result;
  }

  async createArtifact(brandId: number, artifactType: string, title: string, payload: JsonRecord, options: { jobId?: number | null; filePath?: string | null } = {}): Promise<number> {
    return await this.insert(
      `INSERT INTO artifacts
       (brand_id, job_id, artifact_type, title, payload_json, file_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [brandId, options.jobId ?? null, artifactType, title, toJson(payload), options.filePath ?? null, utcNow()]
    );
  }

  async updateArtifactPayload(artifactId: number, payload: JsonRecord): Promise<void> {
    await this.run("UPDATE artifacts SET payload_json = ? WHERE id = ?", [toJson(payload), artifactId]);
  }

  async artifactById(artifactId: number): Promise<JsonRecord | null> {
    return await this.first<JsonRecord>("SELECT * FROM artifacts WHERE id = ?", [artifactId]);
  }

  async artifactByFilename(filename: string): Promise<JsonRecord | null> {
    return await this.first<JsonRecord>(
      "SELECT * FROM artifacts WHERE file_path = ? OR substr(file_path, -?) = ? ORDER BY id DESC LIMIT 1",
      [filename, filename.length, filename]
    );
  }
}
