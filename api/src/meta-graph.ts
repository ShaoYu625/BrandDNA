
import { Env, HttpError } from "./schema";
import { truckOrigin } from "./truck-auth";

export type MetaPlatform = "instagram" | "facebook";
export type GraphObject = Record<string, unknown>;
const GRAPH_ORIGIN = "https://graph.facebook.com";
const META_DIALOG = "https://www.facebook.com/dialog/oauth";

export function platformOf(value: unknown): MetaPlatform {
  if (value !== "instagram" && value !== "facebook") throw new HttpError("請選擇 Instagram 或 Facebook。", 400);
  return value;
}
export function remoteId(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,32}(?:_\d{1,32})?$/.test(value) ? value : null;
}
export function graphObject(value: unknown): GraphObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as GraphObject : {};
}
export function graphRows(value: unknown): GraphObject[] {
  return Array.isArray(value) ? value.map(graphObject) : [];
}
export function graphString(value: unknown, limit = 200): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
export function graphNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function graphDate(value: unknown): string | null {
  const time = Date.parse(graphString(value, 80));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function publicPermalink(value: unknown, platform: MetaPlatform): string | null {
  try {
    const url = new URL(graphString(value, 2048));
    const host = platform === "instagram" ? "instagram.com" : "facebook.com";
    if (url.protocol !== "https:" || url.username || url.password || (url.hostname !== host && !url.hostname.endsWith("." + host))) return null;
    const query = new URLSearchParams();
    if (platform === "facebook" && /^\/(?:permalink|story)\.php$/.test(url.pathname)) {
      for (const key of ["id", "story_fbid"]) {
        const value = remoteId(url.searchParams.get(key));
        if (value) query.set(key, value);
      }
    }
    return url.origin + url.pathname + (query.size ? "?" + query.toString() : "");
  } catch { return null; }
}

export interface MetaConfig { version: string; appId: string; secret: string; configId: string; origin: string; callback: string }

export function metaConfig(env: Env, platform: MetaPlatform): MetaConfig | null {
  const origin = truckOrigin(env);
  const appId = remoteId(env.META_APP_ID);
  const configId = remoteId(platform === "instagram" ? env.META_IG_CONFIG_ID : env.META_FB_CONFIG_ID);
  const version = env.META_GRAPH_VERSION || "";
  const secret = env.META_APP_SECRET;
  if (origin?.protocol !== "https:" || !appId || !configId || !secret || !/^v\d{1,3}\.\d$/.test(version) || (env.TRUCK_MERCHANT_KEY || "").length < 32) return null;
  return { version, appId, configId, secret, origin: origin.origin, callback: origin.origin + "/api/truck/meta/callback" };
}

export function authorizationUrl(config: MetaConfig, state: string): string {
  const query = new URLSearchParams({
    client_id: config.appId, config_id: config.configId, redirect_uri: config.callback,
    response_type: "code", display: "popup", state,
  });
  return META_DIALOG + "?" + query.toString();
}

export class GraphError extends Error {
  constructor(readonly code: number | null, readonly retryable: boolean, readonly uncertain: boolean) {
    super("Meta Graph request failed");
  }
}

export function graphMessage(error: GraphError): string {
  if (error.code === 190 || error.code === 102) return "Meta 授權已失效，請重新連線。";
  if (error.code === 10 || error.code === 200 || error.code === 294) return "Meta 權限不足，請確認帳號角色與應用程式權限。";
  if (error.retryable) return "Meta 服務忙碌或限制了呼叫，請稍後再試。";
  return "Meta 拒絕這項操作，請確認帳號權限與貼文內容。";
}

export async function graph(config: MetaConfig, path: string, query: Record<string, string> = {}, token?: string, form?: Record<string, string>): Promise<GraphObject> {
  const url = new URL("/" + config.version + "/" + path, GRAPH_ORIGIN);
  url.search = new URLSearchParams(query).toString();
  const headers = new Headers({ accept: "application/json" });
  if (token) headers.set("Authorization", "Bearer " + token);
  let response: Response;
  try {
    response = await fetch(url, {
      method: form ? "POST" : "GET", headers, redirect: "manual",
      ...(form ? { body: new URLSearchParams(form) } : {}), signal: AbortSignal.timeout(10000),
    });
  } catch { throw new GraphError(null, true, true); }
  if (response.status >= 300 && response.status < 400) throw new GraphError(null, false, true);
  let result: GraphObject;
  try { result = graphObject(await response.json()); }
  catch { throw new GraphError(null, true, true); }
  const error = graphObject(result.error);
  if (!response.ok || result.error) {
    const code = graphNumber(error.code);
    const retryable = error.is_transient === true || response.status >= 500 || response.status === 429
      || (code !== null && [1, 2, 4, 17, 32, 341, 613, 80001, 80004].includes(code));
    throw new GraphError(code, retryable, response.status >= 500 || (code === null && response.status !== 429));
  }
  return result;
}

export function nextCursor(result: GraphObject): string | null {
  const paging = graphObject(result.paging);
  // The provider may put an access token in paging.next. Only reuse its opaque cursor.
  return typeof paging.next === "string" ? graphString(graphObject(paging.cursors).after, 4096) || null : null;
}

export async function exchange(config: MetaConfig, code: string): Promise<{ token: string; expires: number | null }> {
  const result = await graph(config, "oauth/access_token", {
    client_id: config.appId, client_secret: config.secret, redirect_uri: config.callback, code,
  });
  const token = graphString(result.access_token, 32768);
  if (!token) throw new GraphError(null, false, false);
  const expires = graphNumber(result.expires_in);
  return { token, expires: expires ? Date.now() + expires * 1000 : null };
}

export async function extendFacebookUserToken(config: MetaConfig, token: string): Promise<string> {
  const result = await graph(config, "oauth/access_token", {
    client_id: config.appId, client_secret: config.secret, grant_type: "fb_exchange_token", fb_exchange_token: token,
  });
  const extended = graphString(result.access_token, 32768);
  if (!extended) throw new GraphError(null, false, false);
  return extended;
}

export async function inspectToken(config: MetaConfig, token: string) {
  const result = await graph(config, "debug_token", { input_token: token }, config.appId + "|" + config.secret);
  const data = graphObject(result.data);
  if (data.is_valid !== true || String(data.app_id) !== config.appId) throw new GraphError(190, false, false);
  const expires = [graphNumber(data.expires_at), graphNumber(data.data_access_expires_at)]
    .filter((value): value is number => value !== null && value > 0).map(value => value * 1000);
  const scopes = new Set(Array.isArray(data.scopes) ? data.scopes.filter((value): value is string => typeof value === "string") : []);
  const granular = new Map(graphRows(data.granular_scopes).map(row => {
    const targets = Array.isArray(row.target_ids) ? row.target_ids.flatMap(id => {
      const normalized = typeof id === "number" && Number.isSafeInteger(id) ? String(id) : remoteId(id);
      return normalized ? [normalized] : [];
    }) : [];
    return [graphString(row.scope), targets];
  }));
  return {
    type: graphString(data.type, 40), expires: expires.length ? Math.min(...expires) : null,
    permits(scope: string, id: string): boolean {
      const targets = granular.get(scope);
      return scopes.has(scope) && (!targets?.length || targets.includes(id));
    },
  };
}

async function credentialKey(config: MetaConfig): Promise<CryptoKey> {
  const material = new TextEncoder().encode("truck-meta-token:" + config.appId + ":" + config.secret);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealToken(config: MetaConfig, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await credentialKey(config), new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...iv, ...cipher));
}
export async function openToken(config: MetaConfig, value: string): Promise<string> {
  try {
    const cipher = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: cipher.slice(0, 12) }, await credentialKey(config), cipher.slice(12));
    return new TextDecoder().decode(bytes);
  } catch { throw new HttpError("Meta 連線憑證已變更，請重新連線。", 409); }
}
