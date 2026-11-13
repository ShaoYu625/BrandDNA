
import { Env, HttpError } from "./schema";
import { TRUCK_LIMITS, trimTruckPosts, type Post, type TruckState } from "./routes/truck";
import { fetchOwnedPosts, mediaInsights, reconciliationMatch, verifyPublicationPhoto } from "./meta-content";
import {
  authorizationUrl, exchange, extendFacebookUserToken, graph, graphMessage, graphNumber, graphObject, graphRows, graphString, inspectToken, metaConfig, nextCursor,
  openToken, platformOf, publicPermalink, remoteId, sealToken, GraphError, type MetaConfig, type MetaPlatform,
} from "./meta-graph";
import { truckBody, truckJson, type TruckAuth } from "./truck-auth";

const PLATFORMS = ["instagram", "facebook"] as const;
const FLOW_TTL = 10 * 60 * 1000;
const SYNC_INTERVAL = 6 * 3600 * 1000;
const MAX_WORK_AGE = 30 * 60 * 1000;
const RATE_LIMIT_CODES = [4, 17, 32, 341, 613, 80001, 80004];

interface Asset { id: string; name: string; token: string; canImport: boolean; canPublish: boolean; canReadInsights: boolean }
interface Credential { asset: Asset; configId: string; appId: string; businessId: string | null; expires: number | null; tokenType: string; invalid?: boolean }
interface CandidateList { session: string; until: number; configId: string; appId: string; businessId: string | null; expires: number | null; tokenType: string; assets: Asset[] }
interface Flow { id: string; session: string; until: number; consumed: boolean }
interface Job { version: string; id: string; at: number; phase: "prepare" | "container" | "sending"; started: number | null; container: string | null; attempts: number }

export class TruckMeta {
  private readonly sql: SqlStorage;
  private syncing = false;
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly auth: TruckAuth,
    private readonly read: () => TruckState,
    private readonly write: (state: TruckState, also?: () => void) => void,
  ) { this.sql = storage.sql; }

  initialize(): void {
    this.sql.exec("CREATE TABLE IF NOT EXISTS truck_meta_private (k TEXT PRIMARY KEY, json TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS truck_meta_jobs (id TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS truck_meta_job_time ON truck_meta_jobs (at)");
  }

  private get<T>(key: string): T | null {
    const row = this.sql.exec<{ json: string }>("SELECT json FROM truck_meta_private WHERE k = ?", key).toArray()[0];
    return row ? JSON.parse(row.json) as T : null;
  }

  private set(key: string, value: unknown): void {
    if (value === null) this.sql.exec("DELETE FROM truck_meta_private WHERE k = ?", key);
    else this.sql.exec("INSERT INTO truck_meta_private VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET json = excluded.json", key, JSON.stringify(value));
  }

  private config(platform: MetaPlatform): MetaConfig {
    const config = metaConfig(this.env, platform);
    if (!config) throw new HttpError("此平台尚未設定 Meta 授權。", 503);
    return config;
  }

  private credential(platform: MetaPlatform): Credential | null {
    return this.get("connection:" + platform);
  }

  private usable(conn: Credential, config: MetaConfig): boolean {
    return !conn.invalid && (!conn.expires || conn.expires > Date.now()) && conn.configId === config.configId && conn.appId === config.appId;
  }

  private connected(platform: MetaPlatform, accountId?: string): { conn: Credential; config: MetaConfig } {
    const config = this.config(platform);
    const conn = this.credential(platform);
    if (!conn || !this.usable(conn, config) || (accountId !== undefined && conn.asset.id !== accountId)) {
      throw new HttpError("請在工作區設定連線至這則貼文的 Meta 帳號。", 409);
    }
    return { conn, config };
  }

  private verifyConnection(platform: MetaPlatform, previous: Credential): void {
    if (this.credential(platform)?.asset.token !== previous.asset.token) throw new HttpError("Meta 連線已變更，請再試一次。", 409);
    this.connected(platform, previous.asset.id);
  }

  private invalidate(platform: MetaPlatform, conn: Credential, error: unknown): void {
    if (error instanceof GraphError && [102, 190].includes(error.code ?? 0) && this.credential(platform)?.asset.token === conn.asset.token) {
      this.set("connection:" + platform, { ...conn, invalid: true });
    }
  }

  private status(session: string): Response {
    const platforms = Object.fromEntries(PLATFORMS.map(platform => {
      const config = metaConfig(this.env, platform);
      const conn = this.credential(platform);
      const list = this.get<CandidateList>("assets:" + platform);
      const available = list && list.until > Date.now() && list.session === session && list.configId === config?.configId;
      const asset = conn?.asset;
      return [platform, {
        configured: Boolean(config),
        state: !conn ? "disconnected" : config && this.usable(conn, config) ? "connected" : "reauthorize",
        account: asset ? { id: asset.id, name: asset.name, canImport: asset.canImport, canPublish: asset.canPublish, canReadInsights: asset.canReadInsights } : null,
        candidates: available ? list.assets.map(a => ({ id: a.id, name: a.name, canPublish: a.canPublish })) : [],
        morePosts: Boolean(conn && this.get("cursor:" + platform)),
      }];
    }));
    return truckJson({ success: true, protected: true, platforms });
  }

  async route(request: Request, session: string): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/truck/meta/".length);
    try {
      if (request.method === "GET") {
        if (path === "status") return this.status(session);
        if (path === "callback") return this.callback(url, session);
      }
      if (request.method === "POST") {
        const body = await truckBody(request, 65536);
        if (!this.auth.active(session)) throw new HttpError("請重新登入商家工作台。", 401);
        switch (path) {
          case "connect": return this.connect(platformOf(body.platform), session);
          case "select": return await this.select(platformOf(body.platform), body.accountId, session);
          case "disconnect": return this.disconnect(platformOf(body.platform), session);
          case "import": return await this.importPosts(platformOf(body.platform), body.restart === true, session);
          case "approve": return await this.approve(body, session);
          case "queue": return await this.queue(body, session);
          case "cancel": return this.cancel(body.id, body.attempt);
          case "reconcile": return this.reconcile(body.id, body.importId);
          case "insights/sync": return truckJson({ success: true, ...(await this.syncInsights(session)), state: this.read() });
        }
      }
      return truckJson({ success: false, error: "找不到 Meta 工作台功能。" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return truckJson({ success: false, error: error.message }, error.status);
      if (error instanceof GraphError) return truckJson({ success: false, error: graphMessage(error) }, 502);
      console.error(JSON.stringify({ event: "truck.meta_error", route: path.split("/")[0] }));
      return truckJson({ success: false, error: "Meta 工作台暫時無法儲存，請稍後再試。" }, 500);
    }
  }

  private connect(platform: MetaPlatform, session: string): Response {
    const config = this.config(platform);
    const id = crypto.randomUUID() + "-" + crypto.randomUUID();
    this.set("flow:" + platform, { id, session, until: Date.now() + FLOW_TTL, consumed: false });
    this.set("assets:" + platform, null);
    return truckJson({ success: true, url: authorizationUrl(config, id) });
  }

  private async callback(url: URL, session: string): Promise<Response> {
    const redirect = (outcome: string) => new Response(null, {
      status: 303, headers: { location: "/settings?meta=" + outcome, "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
    const id = url.searchParams.get("state");
    const platform = PLATFORMS.find(item => this.get<Flow>("flow:" + item)?.id === id);
    const flow = platform && this.get<Flow>("flow:" + platform);
    if (!platform || !flow || flow.consumed || flow.session !== session || flow.until <= Date.now()) return redirect("invalid");
    this.set("flow:" + platform, { ...flow, consumed: true });
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code || code.length > 4096) return redirect("cancelled");
    try {
      const config = this.config(platform);
      const exchanged = await exchange(config, code);
      const token = platform === "facebook" ? await extendFacebookUserToken(config, exchanged.token) : exchanged.token;
      const grant = await inspectToken(config, token);
      const expires = platform === "instagram" ? grant.expires ?? exchanged.expires : null;
      const business = platform === "instagram" ? await graph(config, "me", { fields: "client_business_id" }, token) : {};
      const businessId = remoteId(business.client_business_id);
      if (platform === "instagram" && !businessId) return redirect("no-assets");
      const assets = await this.discover(config, platform, token, grant);
      if (!assets.length) return redirect("no-assets");
      if (this.get<Flow>("flow:" + platform)?.id !== id || !this.auth.active(session)) return redirect("invalid");
      this.set("assets:" + platform, {
        session, until: Date.now() + FLOW_TTL, appId: config.appId, configId: config.configId, businessId, expires, tokenType: grant.type, assets,
      });
      return redirect("choose");
    } catch { return redirect("error"); }
  }

  private async discover(config: MetaConfig, platform: MetaPlatform, token: string, grant: Awaited<ReturnType<typeof inspectToken>>): Promise<Asset[]> {
    const isIg = platform === "instagram";
    const igToken = isIg ? await sealToken(config, token) : "";
    const assets = new Map<string, Asset>();
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const result = await graph(config, isIg ? "me/assigned_instagram_accounts" : "me/accounts", {
        fields: isIg ? "id,username" : "id,name,access_token,tasks", limit: "25", ...(cursor ? { after: cursor } : {}),
      }, token);
      for (const row of graphRows(result.data).slice(0, 25)) {
        const id = remoteId(row.id);
        const credential = isIg ? igToken : graphString(row.access_token, 32768);
        if (!id || !credential || assets.has(id)) continue;
        const tasks = Array.isArray(row.tasks) ? row.tasks : [];
        const canImport = grant.permits(isIg ? "instagram_basic" : "pages_read_engagement", id);
        assets.set(id, {
          id, name: graphString(isIg ? row.username : row.name) || id,
          token: isIg ? credential : await sealToken(config, credential),
          canImport,
          canPublish: canImport && grant.permits(isIg ? "instagram_content_publish" : "pages_manage_posts", id)
            && (isIg || tasks.includes("CREATE_CONTENT")),
          canReadInsights: canImport && grant.permits(isIg ? "instagram_manage_insights" : "read_insights", id)
            && (isIg || tasks.includes("ANALYZE")),
        });
      }
      cursor = nextCursor(result);
      if (!cursor) break;
    }
    return [...assets.values()];
  }

  private async select(platform: MetaPlatform, id: unknown, session: string): Promise<Response> {
    const config = this.config(platform);
    const list = this.get<CandidateList>("assets:" + platform);
    const asset = list?.assets.find(entry => entry.id === id);
    if (!list || !asset || list.session !== session || list.until <= Date.now() || list.appId !== config.appId || list.configId !== config.configId) {
      throw new HttpError("帳號清單已失效，請重新授權。", 409);
    }
    let expires = list.expires;
    let tokenType = list.tokenType;
    if (platform === "facebook") {
      const grant = await inspectToken(config, await openToken(config, asset.token));
      expires = grant.expires;
      tokenType = grant.type;
    }
    if (!this.auth.active(session) || this.get<CandidateList>("assets:" + platform)?.assets.find(candidate => candidate.id === id)?.token !== asset.token) {
      throw new HttpError("帳號清單已變更，請重新授權。", 409);
    }
    const previous = this.credential(platform);
    this.storage.transactionSync(() => {
      this.set("connection:" + platform, { asset, appId: list.appId, configId: list.configId, businessId: list.businessId, expires, tokenType });
      this.set("assets:" + platform, null);
      this.set("flow:" + platform, null);
      if (previous?.asset.id !== asset.id) this.set("cursor:" + platform, null);
      if (this.get<number>("sync:next") === null) this.set("sync:next", Date.now() + SYNC_INTERVAL);
    });
    await this.arm();
    return this.status(session);
  }

  private disconnect(platform: MetaPlatform, session: string): Response {
    const jobs = this.sql.exec<{ json: string }>("SELECT json FROM truck_meta_jobs").toArray().map(row => JSON.parse(row.json) as Job);
    const state = structuredClone(this.read());
    const cancelled: string[] = [];
    for (const post of state.posts) {
      if (post.platform !== platform || !post.meta || post.meta.status !== "queued") continue;
      post.meta.status = "cancelled";
      post.meta.version = crypto.randomUUID();
      delete post.meta.attempt;
      post.meta.error = "帳號已解除工作台連線，排程已取消。";
      post.status = "approved";
      post.scheduledAt = null;
      cancelled.push(post.id);
    }
    if (jobs.some(job => job.phase === "sending" && state.posts.some(post => post.id === job.id && post.platform === platform))) {
      throw new HttpError("有貼文正在向 Meta 發送，請等候結果後解除連線。", 409);
    }
    this.write(state, () => {
      for (const key of ["connection:", "flow:", "assets:", "cursor:"]) this.set(key + platform, null);
      for (const id of cancelled) this.deleteJob(id);
      if (!PLATFORMS.some(item => this.credential(item))) this.set("sync:next", null);
    });
    return this.status(session);
  }

  private async importPosts(platform: MetaPlatform, restart: boolean, session: string): Promise<Response> {
    const { conn, config } = this.connected(platform);
    if (!conn.asset.canImport) throw new HttpError("此帳號缺少讀取既有貼文的 Meta 權限。", 403);
    const before = this.get<string>("cursor:" + platform);
    const token = await openToken(config, conn.asset.token);
    try {
      const fetched = await fetchOwnedPosts(config, platform, conn.asset, token, restart ? "" : before || "");
      if (!this.auth.active(session)) throw new HttpError("請重新登入商家工作台。", 401);
      this.verifyConnection(platform, conn);
      if (this.get<string>("cursor:" + platform) !== before) throw new HttpError("貼文清單已更新，請重新操作。", 409);
      const state = structuredClone(this.read());
      const seen = new Set(state.posts.filter(p => p.platform === platform && p.meta?.accountId === conn.asset.id).map(p => p.meta?.remoteId));
      const added: Post[] = [];
      for (const post of fetched.posts) {
        const remote = post.meta?.remoteId;
        if (seen.has(remote)) continue;
        seen.add(remote);
        added.push(post);
      }
      if (state.posts.filter(post => post.mode === "meta").length + added.length > TRUCK_LIMITS.posts) {
        throw new HttpError("工作台的 Meta 貼文已達儲存上限。", 409);
      }
      if (added.length) {
        state.posts.unshift(...added);
        trimTruckPosts(state);
      }
      this.write(state, () => this.set("cursor:" + platform, fetched.cursor));
      return truckJson({ success: true, imported: added.length, more: Boolean(fetched.cursor), state: this.read() });
    } catch (error) {
      this.invalidate(platform, conn, error);
      throw error;
    }
  }

  private post(id: unknown): Post {
    const post = this.read().posts.find(entry => entry.id === id);
    if (!post) throw new HttpError("找不到貼文。", 404);
    return post;
  }

  private replace(post: Post, also?: () => void): void {
    const state = this.read();
    this.write({ ...state, posts: state.posts.map(p => p.id === post.id ? post : p) }, also);
  }

  private async approve(body: Record<string, unknown>, session: string): Promise<Response> {
    const previous = this.post(body.id);
    if (!["draft", "approved"].includes(previous.status) || ["unknown", "published", "queued", "publishing"].includes(previous.meta?.status || "")) {
      throw new HttpError("請使用草稿，或先取消既有排程。", 409);
    }
    const content = graphObject(body.content);
    if (previous.caption !== content.caption || previous.image !== content.image || previous.cardTitle !== content.cardTitle) {
      throw new HttpError("內容已變更，請重新開啟發布預覽。", 409);
    }
    if (!previous.caption.trim() || (previous.platform === "instagram" && [...previous.caption].length > 2200)) {
      throw new HttpError("請填寫文案。Instagram 文案最多 2,200 字元。", 400);
    }
    const accountId = remoteId(body.accountId);
    if (!accountId) throw new HttpError("請選擇發布帳號。", 400);
    const { conn } = this.connected(previous.platform, accountId);
    if (!conn.asset.canPublish) throw new HttpError("此粉專缺少發文任務。", 403);
    const kind = body.kind ?? "photo";
    if (kind !== "photo" && (previous.platform !== "facebook" || (kind !== "text" && kind !== "link"))) {
      throw new HttpError("此平台不支援這個貼文類型。", 400);
    }
    let link: URL | undefined;
    if (kind === "link") {
      try {
        link = new URL(graphString(body.link, 2048));
        if (link.protocol !== "https:" || link.username || link.password) throw new Error();
      } catch { throw new HttpError("請填寫有效的 HTTPS 貼文連結。", 400); }
    }
    const image = kind === "photo" ? await verifyPublicationPhoto(this.env, body.image) : "";
    if (!this.auth.active(session)) throw new HttpError("請重新登入商家工作台。", 401);
    this.verifyConnection(previous.platform, conn);
    const current = this.post(previous.id);
    if (JSON.stringify(previous) !== JSON.stringify(current)) throw new HttpError("內容已變更，請重新開啟發布預覽。", 409);
    const post: Post = {
      ...current, mode: "meta", status: "approved", scheduledAt: null, metrics: null,
      meta: {
        accountId, accountName: conn.asset.name, status: "approved", version: crypto.randomUUID(), kind,
        ...(image ? { image } : {}), ...(link ? { link: link.href } : {}),
      },
    };
    this.replace(post);
    return truckJson({ success: true, state: this.read(), post });
  }

  private async queue(body: Record<string, unknown>, session: string): Promise<Response> {
    const requested = body.scheduledAt;
    const at = requested === undefined ? Date.now() : Date.parse(graphString(requested, 80));
    if (!Number.isFinite(at) || (requested !== undefined && at <= Date.now())) throw new HttpError("請選擇未來的排程時間。", 400);
    const existing = await this.storage.getAlarm();
    const wakeAt = Math.max(Date.now() + 100, at);
    if (existing === null || existing > wakeAt) await this.storage.setAlarm(wakeAt);
    if (!this.auth.active(session)) throw new HttpError("請重新登入商家工作台。", 401);
    const post = structuredClone(this.post(body.id));
    if (!post.meta?.version || post.meta.version !== body.version || !["approved", "failed", "cancelled"].includes(post.meta.status)) {
      throw new HttpError("發布版本已變更或無法再發布，請重新開啟貼文確認狀態。", 409);
    }
    const { conn } = this.connected(post.platform, post.meta.accountId);
    if (!conn.asset.canPublish) throw new HttpError("此帳號目前沒有發布權限。", 403);
    const job: Job = { id: post.id, at, version: crypto.randomUUID(), phase: "prepare", started: null, container: null, attempts: 0 };
    post.status = "scheduled";
    post.scheduledAt = new Date(at).toISOString();
    post.meta.status = "queued";
    post.meta.attempt = job.version;
    delete post.meta.error;
    this.replace(post, () => this.saveJob(job));
    await this.arm();
    return truckJson({ success: true, state: this.read(), post });
  }

  private cancel(id: unknown, attempt: unknown): Response {
    const post = structuredClone(this.post(id));
    if (post.meta?.status !== "queued" || !post.meta.attempt || post.meta.attempt !== attempt) {
      throw new HttpError("這筆排程已變更或已送出，請重新查看貼文。", 409);
    }
    post.status = "approved";
    post.scheduledAt = null;
    post.meta.status = "cancelled";
    post.meta.version = crypto.randomUUID();
    delete post.meta.attempt;
    this.replace(post, () => this.deleteJob(post.id));
    return truckJson({ success: true, state: this.read(), post });
  }

  private reconcile(id: unknown, importedId: unknown): Response {
    const post = structuredClone(this.post(id));
    const imported = this.post(importedId);
    if (!reconciliationMatch(post, imported)) throw new HttpError("選擇的貼文與待查證紀錄不相符。", 409);
    this.recordPublished(post, imported.meta!.remoteId!);
    return truckJson({ success: true, state: this.read() });
  }

  private recordPublished(post: Post, remote: string, also?: () => void): void {
    if (!post.meta) return;
    const state = this.read();
    const same = (item: Post) => item.id !== post.id && item.platform === post.platform
      && item.meta?.accountId === post.meta?.accountId && item.meta?.remoteId === remote;
    const imported = state.posts.find(same);
    post.meta.status = "published";
    post.meta.remoteId = remote;
    if (imported?.meta?.permalink) post.meta.permalink = imported.meta.permalink;
    if (imported?.meta?.thumbnail) post.meta.thumbnail = imported.meta.thumbnail;
    if (imported?.metrics) post.metrics = imported.metrics;
    delete post.meta.error;
    delete post.meta.attempt;
    post.status = "published";
    post.publishedAt = imported?.publishedAt ?? new Date().toISOString();
    const posts = state.posts.filter(item => !same(item)).map(item => item.id === post.id ? post : item);
    this.write({ ...state, posts }, also);
  }

  private job(id: string): Job | null {
    const row = this.sql.exec<{ json: string }>("SELECT json FROM truck_meta_jobs WHERE id = ?", id).toArray()[0];
    return row ? JSON.parse(row.json) as Job : null;
  }

  private saveJob(job: Job): void {
    this.sql.exec("INSERT INTO truck_meta_jobs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, json = excluded.json",
      job.id, job.at, JSON.stringify(job));
  }

  private deleteJob(id: string): void {
    this.sql.exec("DELETE FROM truck_meta_jobs WHERE id = ?", id);
  }

  private async arm(): Promise<void> {
    const job = this.sql.exec<{ at: number }>("SELECT at FROM truck_meta_jobs ORDER BY at LIMIT 1").toArray()[0];
    const next = Math.min(job?.at ?? Infinity, this.get<number>("sync:next") ?? Infinity);
    if (Number.isFinite(next)) await this.storage.setAlarm(Math.max(Date.now() + 50, next));
  }

  async alarm(): Promise<void> {
    // Leave a durable wake-up in place before network I/O so an eviction can't strand a job.
    await this.storage.setAlarm(Date.now() + 30000);
    const next = this.sql.exec<{ json: string }>("SELECT json FROM truck_meta_jobs WHERE at <= ? ORDER BY at LIMIT 1", Date.now()).toArray()[0];
    try {
      if (next) await this.publish(JSON.parse(next.json) as Job);
      else if ((this.get<number>("sync:next") ?? Infinity) <= Date.now()) {
        this.set("sync:next", Date.now() + SYNC_INTERVAL);
        await this.syncInsights();
      }
    } finally {
      const remaining = this.sql.exec("SELECT 1 FROM truck_meta_jobs LIMIT 1").toArray().length;
      if (remaining || this.get<number>("sync:next") !== null) await this.arm();
      else await this.storage.deleteAlarm();
    }
  }

  private finish(job: Job, result: { status: "published"; id: string } | { status: "failed" | "unknown"; error: string }): void {
    if (this.job(job.id)?.version !== job.version) return;
    const post = structuredClone(this.post(job.id));
    if (!post.meta) return;
    if (result.status === "published") {
      this.recordPublished(post, result.id, () => this.deleteJob(job.id));
      return;
    }
    post.meta.status = result.status;
    post.meta.error = result.error;
    post.meta.version = crypto.randomUUID();
    delete post.meta.attempt;
    if (result.status === "unknown") {
      post.meta.attemptedAt = new Date(job.started ?? Date.now()).toISOString();
      if (job.container) post.meta.containerId = job.container;
    }
    post.status = "approved";
    this.replace(post, () => this.deleteJob(job.id));
  }

  private async publish(job: Job): Promise<void> {
    const post = this.read().posts.find(item => item.id === job.id);
    if (!post?.meta) { this.deleteJob(job.id); return; }
    const platform = post.platform;
    const accountId = post.meta.accountId;
    const current = () => this.job(job.id)?.version === job.version;
    let connection: ReturnType<TruckMeta["connected"]> | undefined;
    let token = "";
    try {
      connection = this.connected(platform, accountId);
      const { config, conn } = connection;
      if (!conn.asset.canPublish) throw new HttpError("此帳號目前沒有發布權限。", 403);
      token = await openToken(config, conn.asset.token);
      if (!current()) return;
      if (job.phase === "sending") {
        await this.unknown(job, config, token);
        return;
      }
      job.started ??= Date.now();
      if (Date.now() - job.started > MAX_WORK_AGE) throw new HttpError("等待 Meta 處理逾時，請確認後再排程。", 409);
      const kind = post.meta.kind || "photo";
      const image = post.meta.image ? config.origin + post.meta.image : "";
      if (kind === "photo" && !image) throw new HttpError("找不到已確認的發布圖片。", 409);
      if (platform === "instagram" && !job.container) {
        const limit = await graph(config, accountId + "/content_publishing_limit", { fields: "quota_usage,config" }, token);
        if (!current()) return;
        this.verifyConnection(platform, conn);
        const usage = graphRows(limit.data)[0];
        const used = graphNumber(usage?.quota_usage);
        const quota = graphNumber(graphObject(usage?.config).quota_total);
        if (used !== null && quota !== null && used >= quota) throw new GraphError(4, true, false);
        const container = await graph(config, accountId + "/media", {}, token, { image_url: image, caption: post.caption });
        if (!current()) return;
        job.container = remoteId(container.id);
        if (!job.container) throw new HttpError("Meta 未回傳圖片容器，請稍後再試。", 502);
        job.phase = "container";
        this.saveJob(job);
      }
      if (job.container) {
        const result = await graph(config, job.container, { fields: "status_code" }, token);
        if (!current()) return;
        if (result.status_code === "IN_PROGRESS") { this.saveJob({ ...job, at: Date.now() + 20000 }); return; }
        if (result.status_code !== "FINISHED") throw new HttpError("Meta 無法處理發布圖片，請確認圖片後再試。", 409);
      }
      this.verifyConnection(platform, conn);
      if (!current()) return;
      const sending = { ...post, meta: { ...post.meta, status: "publishing" as const } };
      job.phase = "sending";
      this.replace(sending, () => this.saveJob(job));
      // Persist the sending fence before making an operation that can create a live post.
      await this.storage.sync();
      const result = platform === "instagram"
        ? await graph(config, accountId + "/media_publish", {}, token, { creation_id: job.container! })
        : kind === "photo"
          ? await graph(config, accountId + "/photos", {}, token, { url: image, caption: post.caption, published: "true" })
          : await graph(config, accountId + "/feed", {}, token, { message: post.caption, ...(post.meta.link ? { link: post.meta.link } : {}) });
      const id = remoteId(platform === "facebook" && kind === "photo" ? result.post_id : result.id);
      if (!id) { await this.unknown(job, config, token); return; }
      this.finish(job, { status: "published", id });
      await this.updatePermalink(post, config, token, id);
    } catch (error) {
      if (!current()) return;
      if (connection) this.invalidate(platform, connection.conn, error);
      const sending = job.phase === "sending";
      const definiteLimit = error instanceof GraphError && !error.uncertain && RATE_LIMIT_CODES.includes(error.code ?? 0);
      if (sending && (!connection || !(error instanceof GraphError) || error.uncertain || (error.retryable && !definiteLimit))) {
        await this.unknown(job, connection?.config, token);
        return;
      }
      if (error instanceof GraphError && error.retryable && job.attempts < 4) {
        job.phase = job.container ? "container" : "prepare";
        job.attempts++;
        job.at = Date.now() + 30000 * 2 ** (job.attempts - 1);
        this.replace({ ...post, meta: { ...post.meta, status: "queued" } }, () => this.saveJob(job));
        return;
      }
      const message = error instanceof HttpError ? error.message : error instanceof GraphError ? graphMessage(error) : "發文前發生錯誤，請稍後重試。";
      this.finish(job, { status: "failed", error: message });
    }
  }

  private async unknown(job: Job, config?: MetaConfig, token = ""): Promise<void> {
    let message = "Meta 未回傳可驗證的貼文 ID。請先到平台確認，避免重複發布。";
    if (config && token && job.container) {
      try {
        const data = await graph(config, job.container, { fields: "status_code" }, token);
        if (data.status_code === "PUBLISHED") message = "Meta 顯示圖片容器已發布，但未回傳貼文 ID。請到 Instagram 確認並匯入該貼文。";
      } catch { /* A failed status read cannot resolve an ambiguous publication. */ }
    }
    this.finish(job, { status: "unknown", error: message });
  }

  private async updatePermalink(post: Post, config: MetaConfig, token: string, id: string): Promise<void> {
    const field = post.platform === "instagram" ? "permalink" : "permalink_url";
    try {
      const data = await graph(config, id, { fields: field }, token);
      const permalink = publicPermalink(data[field], post.platform);
      const latest = this.post(post.id);
      if (permalink && latest.meta?.remoteId === id) this.replace({ ...latest, meta: { ...latest.meta, permalink } });
    } catch { /* The confirmed remote ID is enough to record a successful publication. */ }
  }

  private async syncInsights(session?: string): Promise<{ synced: number; failed: number }> {
    if (this.syncing) throw new HttpError("正在更新 Meta 成效，請稍後再試。", 409);
    this.syncing = true;
    try {
      const eligible = this.read().posts.filter(p => {
        const conn = this.credential(p.platform);
        const config = metaConfig(this.env, p.platform);
        return p.meta?.remoteId && conn?.asset.id === p.meta.accountId && conn.asset.canReadInsights && config && this.usable(conn, config);
      });
      eligible.sort((a, b) => (a.meta?.insightsCheckedAt || "").localeCompare(b.meta?.insightsCheckedAt || ""));
      const checkedAt = new Date().toISOString();
      const results = await Promise.all(eligible.slice(0, 5).map(async post => {
        const { conn, config } = this.connected(post.platform, post.meta!.accountId);
        try {
          const token = await openToken(config, conn.asset.token);
          const metrics = await mediaInsights(config, post.platform, post.meta!.remoteId!, token);
          return { post, conn, metrics, error: null };
        } catch (error) {
          this.invalidate(post.platform, conn, error);
          return { post, conn, metrics: null, error: error instanceof GraphError ? graphMessage(error) : "無法取得 Meta 成效。" };
        }
      }));
      if (session && !this.auth.active(session)) throw new HttpError("請重新登入商家工作台。", 401);
      let synced = 0;
      let failed = 0;
      const state = this.read();
      const posts = state.posts.map(post => {
        const match = results.find(result => result.post.id === post.id && result.post.meta?.remoteId === post.meta?.remoteId
          && this.credential(post.platform)?.asset.token === result.conn.asset.token);
        if (!match || !post.meta) return post;
        if (match.metrics) synced++;
        else failed++;
        return { ...post, metrics: match.metrics ?? post.metrics, meta: { ...post.meta, insightsCheckedAt: checkedAt, insightsError: match.error } };
      });
      if (synced || failed) this.write({ ...state, posts });
      return { synced, failed };
    } finally { this.syncing = false; }
  }
}
