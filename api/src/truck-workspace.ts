import {
  ActionExtras, ActionResult, TruckState, applyTruckAction, assistantPlan, blankTruckState, handleTruckMedia, normalizeTruckState, publicView,
  readTruckMedia, referencedMediaKeys, seedTruckState, serveTruckApi, subscriptionFrom, taipeiDate
} from "./routes/truck";
import { PersistIndex, PersistPlan, StoredItem, emptyIndex, planPersist, rebuildState } from "./truck-store";
import { HttpError, type Env, type JsonRecord } from "./schema";
import { TruckAuth, truckBody, truckJson, truckOrigin } from "./truck-auth";
import { TruckMeta } from "./truck-meta";
import { TruckAI, fetchTrendSignals } from "./truck-ai";
import { renameAccount } from "./truck-accounts";

interface SocketAttachment { view: "merchant" | "public"; order: string | null; member: string | null; sig: string; session?: string | null }
interface Identity { id: string; slug: string; name: string; flagship: boolean }
const MAX_SOCKETS = 300;
const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;
const PUBLIC_PATHS = new Set(["/api/truck/public", "/api/truck/public/actions", "/api/truck/ws"]);

function parseIdentity(header: string | null): Identity | null {
  if (!header) return null;
  try {
    const value = JSON.parse(decodeURIComponent(header)) as Partial<Identity>;
    return typeof value.id === "string" && typeof value.slug === "string" && typeof value.name === "string" ? { id: value.id, slug: value.slug, name: value.name, flagship: value.flagship === true } : null;
  } catch { return null; }
}
function payloadRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * One food truck's workspace. The Worker routes every truck account to its own object (the flagship keeps the
 * original "workspace" object). A Durable Object serialises writes, keeps the state in memory between requests and
 * pushes changes to open pages over hibernatable WebSockets.
 */
export class TruckWorkspace implements DurableObject {
  private state: TruckState | null = null;
  private identity: Identity | null = null;
  private index: PersistIndex = emptyIndex();
  private merchantMessage = { revision: -1, body: "" };
  private readonly auth: TruckAuth;
  private readonly meta: TruckMeta;
  private readonly ai: TruckAI;
  private readonly inflight = new Map<string, Promise<ActionResult>>();

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    this.auth = new TruckAuth(ctx.storage.sql);
    this.ai = new TruckAI(env, ctx.storage.sql);
    this.meta = new TruckMeta(ctx.storage, env, this.auth, () => this.current(), (state, also) => {
      this.commit({ ...state, revision: this.current().revision + 1 }, also);
    });
    // Heartbeats are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private current(): TruckState {
    if (!this.state) throw new HttpError("工作台尚未準備完成，請重新整理。", 503);
    return this.state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      await this.ensure(parseIdentity(request.headers.get("x-truck-internal-account")));
      if (path === "/internal/daily" && request.method === "POST") {
        const outcome = await this.mutate("assistant.check", {}, null).catch(error => ({ error: error instanceof Error ? error.message : String(error) }));
        return truckJson({ success: true, media: [...referencedMediaKeys(this.current())], assistant: "error" in outcome ? outcome.error : outcome.result });
      }
      if (path === "/internal/media" && request.method === "GET") return truckJson({ success: true, media: [...referencedMediaKeys(this.current())] });
      if (path === "/internal/revoke" && request.method === "POST") {
        const body = await truckBody(request, 1024);
        const session = typeof body.session === "string" ? body.session : "";
        this.auth.revoke(session);
        for (const socket of this.ctx.getWebSockets()) {
          if ((socket.deserializeAttachment() as SocketAttachment | null)?.session === session) socket.close(1008, "Merchant session ended");
        }
        return truckJson({ success: true });
      }
      // The Worker attaches a session only to signed-in merchant requests; everything else is a customer.
      const session = request.headers.get("x-truck-internal-session");
      if (session) this.auth.touch(session, Number(request.headers.get("x-truck-internal-expires")));
      if (!session && !PUBLIC_PATHS.has(path)) throw new HttpError("請先登入商家工作台。", 401);
      if (path.startsWith("/api/truck/meta/") && session) return await this.meta.route(request, session);
      if (path === "/api/truck/ws") return this.openSocket(request, url, session);
      if (path === "/api/truck/ai/status" && request.method === "GET") return truckJson({ success: true, ai: this.ai.status() });
      if (path === "/api/truck/ai/copy" && request.method === "POST") {
        const body = await truckBody(request, 4096);
        const copy = await this.ai.copy(this.current(), body as JsonRecord, new Date().toISOString()).catch(() => null);
        return truckJson({ success: true, copy });
      }
      const media = await handleTruckMedia(request, this.env);
      if (media) return media;
      const realtime = truckOrigin(this.env) ?? forwardedOrigin(request) ?? url;
      return serveTruckApi(request, {
        read: () => this.current(),
        mutate: (type, payload, key) => {
          if (session && !this.auth.active(session)) throw new HttpError("請重新登入商家工作台。", 401);
          return this.mutate(type, payload, key ? (session ? "merchant:" : "public:") + key : null);
        },
      }, { realtimeUrl: `${realtime.protocol === "https:" ? "wss:" : "ws:"}//${realtime.host}/api/truck/ws` });
    } catch (error) {
      if (error instanceof HttpError) return truckJson({ success: false, error: error.message }, error.status);
      console.error(JSON.stringify({ event: "truck.request_error", message: error instanceof Error ? error.message : String(error) }));
      return truckJson({ success: false, error: "工作台暫時無法連線。" }, 503);
    }
  }

  alarm(): Promise<void> { return this.meta.alarm(); }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string" || message.length > 2000) return;
    let data: Record<string, unknown>;
    try { data = JSON.parse(message) as Record<string, unknown>; } catch { return; }
    if (data?.type !== "subscribe") return;
    const current = ws.deserializeAttachment() as SocketAttachment | null;
    const ids = subscriptionFrom(new URL(`https://workspace/?${new URLSearchParams({ order: String(data.order ?? ""), member: String(data.member ?? "") })}`));
    this.send(ws, { view: current?.view ?? "public", order: ids.order ?? null, member: ids.member ?? null, sig: "", session: current?.session ?? null });
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  webSocketError(): void { /* the runtime closes the socket; nothing to clean up */ }

  private openSocket(request: Request, url: URL, session: string | null): Response {
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response("Expected a WebSocket upgrade.", { status: 426 });
    const view = url.searchParams.get("view") === "merchant" ? "merchant" : "public";
    if (view === "merchant" && !session) throw new HttpError("請先登入商家工作台。", 401);
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response("Too many open connections.", { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const ids = subscriptionFrom(url);
    this.ctx.acceptWebSocket(server);
    this.send(server, { view, order: ids.order ?? null, member: ids.member ?? null, sig: "", session });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async load(): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS truck_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS truck_items (col TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (col, id))");
    sql.exec("CREATE TABLE IF NOT EXISTS truck_idempotency (k TEXT PRIMARY KEY, result TEXT NOT NULL, created_at INTEGER NOT NULL)");
    this.auth.initialize();
    this.meta.initialize();
    this.ai.initialize();
    const metaRows = sql.exec<{ k: string; v: string }>("SELECT k, v FROM truck_meta").toArray();
    this.identity = parseIdentity(metaRows.find(row => row.k === "identity")?.v ?? null);
    const restored = rebuildState(
      metaRows.filter(row => row.k !== "identity" && row.k !== "merchant_gate"),
      sql.exec<{ col: string; id: string; seq: number; json: string }>("SELECT col, id, seq, json FROM truck_items").toArray() as StoredItem[]
    );
    if (!restored) return;
    this.index = restored.index;
    this.state = normalizeTruckState(restored.state);
    // Persist anything the upgrade filled in (only changed rows are written).
    this.write(planPersist(this.index, this.state));
  }

  /** First request with an identity creates the workspace: the flagship imports or seeds its data, new trucks start empty. */
  private async ensure(identity: Identity | null): Promise<void> {
    if (identity && JSON.stringify(identity) !== JSON.stringify(this.identity)) {
      this.identity = identity;
      this.ctx.storage.sql.exec("INSERT INTO truck_meta (k, v) VALUES ('identity', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", encodeURIComponent(JSON.stringify(identity)));
    }
    if (this.state) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.state) return;
      const who = this.identity;
      // Requests without an identity only come from older deployments of the single flagship workspace.
      const flagship = !who || who.flagship;
      const initial = flagship ? (await this.importD1Workspace()) ?? seedTruckState() : blankTruckState(who.name);
      this.state = normalizeTruckState(initial);
      this.write(planPersist(emptyIndex(), this.state));
    });
  }

  private async importD1Workspace(): Promise<TruckState | null> {
    try {
      const row = await this.env.DB.prepare("SELECT state_json, revision FROM truck_workspace WHERE id = 1").first<{ state_json: string; revision: number }>();
      if (!row) return null;
      const state = JSON.parse(row.state_json) as TruckState;
      state.revision = row.revision;
      return state;
    } catch {
      return null;
    }
  }

  private write(plan: PersistPlan, alsoInTransaction?: () => void): void {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const [k, v] of plan.meta) sql.exec("INSERT INTO truck_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
      for (const row of plan.upserts) sql.exec("INSERT INTO truck_items (col, id, seq, json) VALUES (?, ?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET seq = excluded.seq, json = excluded.json", row.col, row.id, row.seq, row.json);
      for (const row of plan.deletes) sql.exec("DELETE FROM truck_items WHERE col = ? AND id = ?", row.col, row.id);
      alsoInTransaction?.();
    });
    this.index = plan.index;
  }

  /** Network work (LLM, page fetch, OCR) happens before the pure transition; its output is passed separately from the client payload. */
  private async prepare(type: string, rawPayload: unknown): Promise<ActionExtras> {
    const state = this.current();
    const payload = payloadRecord(rawPayload);
    const now = new Date().toISOString();
    const ai = async (run: () => Promise<JsonRecord | null>): Promise<ActionExtras> => {
      try {
        const output = await run();
        return output ? { ai: output } : {};
      } catch (error) {
        const message = error instanceof HttpError ? error.message : "AI 暫時無法回應";
        console.warn(JSON.stringify({ event: "truck.ai_fallback", type, message: error instanceof Error ? error.message : String(error) }));
        return { aiError: `${message.replace(/。$/, "")}，已改用內建範本。` };
      }
    };
    switch (type) {
      case "post.generate": {
        const trend = typeof payload.trendId === "string" ? state.trends?.items.find(item => item.id === payload.trendId && item.kind === "hot") : undefined;
        const hook = trend && typeof payload.hookId === "string" ? trend.hooks?.find(item => item.id === payload.hookId) : undefined;
        const code = typeof payload.couponCode === "string" ? payload.couponCode.trim().toUpperCase() : "";
        const coupon = code ? state.coupons.find(row => row.code === code && row.active) : undefined;
        return ai(() => this.ai.post(state, {
          platform: String(payload.platform || "instagram"), topic: String(payload.topic || ""), topicKey: trend ? "trend" : String(payload.topicKey || ""),
          ...(trend ? { trend: {
            title: trend.title, summary: trend.summary || "", riskNote: trend.riskNote || "",
            hook: hook ? { title: hook.title, angle: hook.angle } : null,
            // "11/16": the date customers read, not an ISO timestamp.
            coupon: coupon ? { code: coupon.code, label: coupon.label, validUntil: coupon.expiresAt ? taipeiDate(coupon.expiresAt).slice(5).replace("-", "/") : null } : null
          } } : {})
        }, now));
      }
      case "assistant.check": {
        const plan = assistantPlan(state, now, payload.force === true);
        if (!plan.suggest) return {};
        return ai(() => this.ai.post(state, { platform: payload.platform === "facebook" ? "facebook" : "instagram", topic: plan.topic.topic, topicKey: plan.topic.key, idleDays: plan.idleDays }, now));
      }
      case "diagnosis.run": return ai(() => this.ai.diagnosis(state));
      case "trends.refresh": {
        // This week's talked-about topics (any field): Google News headlines + Google search spikes. The AI clusters them,
        // writes joke hooks with offers and judges the risk; links always come from the feeds.
        let signals;
        try { signals = await fetchTrendSignals(); } catch (error) {
          console.warn(JSON.stringify({ event: "truck.trends_fetch_failed", message: error instanceof Error ? error.message : String(error) }));
          return { prepared: { signals: null, error: error instanceof HttpError ? error.message : "今天的熱門話題暫時抓不到，稍後再按「更新」。" } };
        }
        const judged = await ai(() => this.ai.hotTopics(state, signals, now));
        return { ...judged, prepared: { signals } };
      }
      case "menu.translate": {
        if (!this.ai.enabled) return { aiError: "自動翻譯需要啟用 AI（設定 OPENAI_API_KEY），也可以在各餐點手動填寫英文。" };
        return ai(() => this.ai.translate(state));
      }
      case "source.import": {
        // Website content arrives as text the browser read from uploaded .html files (kind "batch"); the Worker fetches no merchant URLs.
        if (payload.kind === "ocr") {
          const image = await readTruckMedia(this.env, String(payload.image || ""));
          const output = await this.ai.ocr(image, String(payload.hint || "").slice(0, 200));
          const textContent = String(output?.text || "").trim();
          if (!textContent) throw new HttpError("圖片裡沒有辨識到文字。", 422);
          return { prepared: { items: [{ title: String(payload.title || "").trim() || `圖片辨識｜${String(output?.title || "圖片文字")}`, type: String(payload.type || "manual"), content: `${textContent}\n\n圖片位置：${String(payload.image)}` }] } };
        }
        return {};
      }
      case "workspace.reset":
      case "demo.reset":
        return this.identity && !this.identity.flagship ? { prepared: "blank" } : {};
      default:
        return {};
    }
  }

  private async mutate(type: string, payload: unknown, idempotencyKey: string | null): Promise<ActionResult> {
    const sql = this.ctx.storage.sql;
    const replay = (): ActionResult | null => {
      if (!idempotencyKey) return null;
      // A retried request (lost response, flaky mobile network) replays the original outcome instead of acting twice.
      const hit = sql.exec<{ result: string }>("SELECT result FROM truck_idempotency WHERE k = ?", idempotencyKey).toArray()[0];
      return hit ? { state: this.current(), result: { ...JSON.parse(hit.result) as Record<string, unknown>, replayed: true } } : null;
    };
    const cached = replay();
    if (cached) return cached;
    const running = idempotencyKey ? this.inflight.get(idempotencyKey) : undefined;
    if (running) return running;
    const run = (async () => {
      const extras = await this.prepare(type, payload);
      const raced = replay();
      if (raced) return raced;
      const now = Date.now();
      const next = applyTruckAction(this.current(), type, payload, new Date(now).toISOString(), extras);
      if (next.noop) return { state: this.current(), result: next.result };
      const written = this.commit(next.state, () => {
        if (!idempotencyKey) return;
        sql.exec("INSERT INTO truck_idempotency (k, result, created_at) VALUES (?, ?, ?)", idempotencyKey, JSON.stringify(next.result), now);
        sql.exec("DELETE FROM truck_idempotency WHERE created_at < ?", now - IDEMPOTENCY_TTL_MS);
      });
      console.log(JSON.stringify({ event: "truck.action", type, revision: next.state.revision, rowsWritten: written }));
      if (type === "brand.update" && this.identity && next.state.brand.name !== this.identity.name) {
        await renameAccount(this.env, this.identity.id, next.state.brand.name).catch(() => undefined);
      }
      return next;
    })();
    if (idempotencyKey) {
      this.inflight.set(idempotencyKey, run);
      const done = () => { this.inflight.delete(idempotencyKey); };
      run.then(done, done);
    }
    return run;
  }

  private commit(state: TruckState, also?: () => void): number {
    const plan = planPersist(this.index, state);
    this.write(plan, also);
    this.state = state;
    for (const ws of this.ctx.getWebSockets()) this.send(ws);
    return plan.meta.length + plan.upserts.length + plan.deletes.length;
  }

  /** Sends the socket its view only when that view changed; customer pages skip unrelated merchant edits. */
  private send(ws: WebSocket, attachment = ws.deserializeAttachment() as SocketAttachment | null): void {
    if (!attachment || !this.state) return;
    let body: string;
    let sig: string;
    if (attachment.view === "merchant") {
      if (!this.auth.active(attachment.session ?? null)) {
        try { ws.close(1008, "Merchant session ended"); } catch { /* already closed */ }
        return;
      }
      if (this.merchantMessage.revision !== this.state.revision) this.merchantMessage = { revision: this.state.revision, body: JSON.stringify({ type: "state", state: this.state }) };
      body = this.merchantMessage.body;
      sig = `r${this.state.revision}`;
    } else {
      const view = publicView(this.state, attachment);
      const { revision: _revision, ...content } = view;
      sig = fingerprint(JSON.stringify(content));
      body = JSON.stringify({ type: "state", state: view });
    }
    if (sig === attachment.sig) return;
    try {
      ws.send(body);
      ws.serializeAttachment({ ...attachment, sig });
    } catch { /* the socket is closing */ }
  }
}

/** Origin the browser used when the request came through the Pages proxy, so sockets reuse the same cookies. */
function forwardedOrigin(request: Request): URL | null {
  const host = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto");
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host) || (proto !== "https" && proto !== "http")) return null;
  try { return new URL(`${proto}://${host}`); } catch { return null; }
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}
