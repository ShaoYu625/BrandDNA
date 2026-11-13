import { handleRequest } from "./routes/api";
import { cleanupTruckMedia, handleTruckMedia, handleTruckRequest, readTruckState, referencedMediaKeys } from "./routes/truck";
import { requireTruckOrigin, truckJson } from "./truck-auth";
import {
  FLAGSHIP_SLUG, accountBySlug, countAccounts, ensureAccounts, handleAccountRoute, listAccounts, pickSession, resolveSessions,
  type TruckAccount, type TruckSession
} from "./truck-accounts";
import { handleMetaWebhook } from "./meta-webhook";
import { AppContext, Env, HttpError, normalizePlan, normalizeRunId } from "./schema";

export { TruckWorkspace } from "./truck-workspace";

const PUBLIC_PATHS = new Set(["/api/truck/public", "/api/truck/public/actions"]);

/** The flagship keeps the original single-workspace object so its existing data stays in place. */
function workspace(env: Env, account: TruckAccount): DurableObjectStub | null {
  if (!env.TRUCK_WORKSPACE) return null;
  return env.TRUCK_WORKSPACE.get(env.TRUCK_WORKSPACE.idFromName(account.flagship ? "workspace" : `truck:${account.id}`));
}
function identityHeader(account: TruckAccount): string {
  return encodeURIComponent(JSON.stringify({ id: account.id, slug: account.slug, name: account.name, flagship: account.flagship }));
}

async function forward(request: Request, env: Env, account: TruckAccount, session: TruckSession | null): Promise<Response> {
  const stub = workspace(env, account);
  if (!stub) {
    // D1-only deployments (no Durable Object binding) serve the flagship workspace row.
    if (!account.flagship) return truckJson({ success: false, error: "此部署只支援單一餐車工作台。" }, 503);
    return handleTruckRequest(request, env);
  }
  const headers = new Headers(request.headers);
  const internal: string[] = [];
  headers.forEach((_value, name) => { if (name.startsWith("x-truck-internal-")) internal.push(name); });
  for (const name of internal) headers.delete(name);
  headers.set("x-truck-internal-account", identityHeader(account));
  if (session) {
    headers.set("x-truck-internal-session", session.id);
    headers.set("x-truck-internal-expires", String(session.expires));
  }
  try {
    return await stub.fetch(new Request(request, { headers }));
  } catch {
    console.error(JSON.stringify({ event: "truck.workspace_error", truck: account.slug }));
    return truckJson({ success: false, error: "工作台暫時無法連線，請稍後重試。" }, 503);
  }
}

async function truckRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/truck/meta/webhook") return handleMetaWebhook(request, env);
  if (url.pathname.startsWith("/api/truck/media/")) {
    const media = await handleTruckMedia(request, env);
    if (media) return media;
  }
  try {
    await ensureAccounts(env);
    const accountRoute = await handleAccountRoute(request, env, async (account, path, body) => {
      const stub = workspace(env, account);
      if (stub) await stub.fetch(`https://workspace${path}`, { method: "POST", headers: { "content-type": "application/json", "x-truck-internal-account": identityHeader(account) }, body: JSON.stringify(body) });
    });
    if (accountRoute) return accountRoute;

    const isPublic = PUBLIC_PATHS.has(url.pathname) || (url.pathname === "/api/truck/ws" && url.searchParams.get("view") !== "merchant");
    if (isPublic) {
      const account = await accountBySlug(env, url.searchParams.get("truck") || FLAGSHIP_SLUG);
      if (!account) return truckJson({ success: false, error: "找不到這台餐車，請確認點餐連結。" }, 404);
      return forward(request, env, account, null);
    }
    const session = pickSession(await resolveSessions(env, request), request);
    if (!session) return truckJson({ success: false, error: "請先登入商家工作台。" }, 401);
    if (request.method !== "GET" || url.pathname === "/api/truck/ws") requireTruckOrigin(request, env);
    return forward(request, env, session.account, session);
  } catch (error) {
    if (error instanceof HttpError) return truckJson({ success: false, error: error.message }, error.status);
    console.error(JSON.stringify({ event: "truck.route_error", message: error instanceof Error ? error.message : String(error) }));
    return truckJson({ success: false, error: "工作台暫時無法連線，請稍後重試。" }, 503);
  }
}

/** Daily: each truck checks its posting rhythm (idle-post assistant), then photos no workspace references are removed. */
async function dailyMaintenance(env: Env): Promise<void> {
  await ensureAccounts(env);
  const accounts = await listAccounts(env, 40);
  const keep = new Set<string>();
  for (const account of accounts) {
    const stub = workspace(env, account);
    if (!stub) {
      if (account.flagship) for (const key of referencedMediaKeys(await readTruckState(env.DB, new Date().toISOString()))) keep.add(key);
      continue;
    }
    const response = await stub.fetch("https://workspace/internal/daily", { method: "POST", headers: { "x-truck-internal-account": identityHeader(account) } });
    if (!response.ok) throw new Error(`Daily maintenance failed for ${account.slug}.`);
    for (const key of ((await response.json()) as { media?: string[] }).media ?? []) keep.add(key);
  }
  // Only delete when every workspace was asked which photos it still uses.
  if ((await countAccounts(env)) > accounts.length) {
    console.log(JSON.stringify({ event: "truck.media_cleanup", skipped: "too many accounts for one run" }));
    return;
  }
  const removed = await cleanupTruckMedia(env, keep);
  console.log(JSON.stringify({ event: "truck.media_cleanup", removed, trucks: accounts.length }));
}

export default {
  async fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/truck/")) return truckRequest(request, env);
    const requestId = request.headers.get("cf-ray") || crypto.randomUUID().slice(0, 12);
    const ctx: AppContext = {
      env,
      executionCtx,
      state: {
        requestId,
        startedAt: Date.now(),
        aiUsage: [],
        plan: normalizePlan(request.headers.get("X-BrandDNA-Plan")),
        runId: normalizeRunId(request.headers.get("X-BrandDNA-Run-Id"))
      }
    };

    return await handleRequest(request, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, executionCtx: ExecutionContext): Promise<void> {
    executionCtx.waitUntil(dailyMaintenance(env));
  }
};
