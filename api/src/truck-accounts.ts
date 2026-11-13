import { Env, HttpError } from "./schema";
import { requireTruckOrigin, sha256Hex, truckBody, truckJson, truckOrigin } from "./truck-auth";

/** One merchant account per food truck: the store name is the account name, one username and password. */
export interface TruckAccount { id: string; slug: string; name: string; username: string; flagship: boolean; createdAt: string }
export interface TruckSession { id: string; token: string; expires: number; account: TruckAccount }
interface AccountRow { id: string; slug: string; name: string; username: string; flagship: number; created_at: string }

export const FLAGSHIP_SLUG = "haihai";
export const FLAGSHIP_USERNAME = "haihai";
export const DEFAULT_FLAGSHIP_PASSWORD = "haihai2026";
const FLAGSHIP = { id: "acct-haihai", slug: FLAGSHIP_SLUG, name: "海海人生行動餐車", username: FLAGSHIP_USERNAME };
const AUTH_COOKIE = "truck_auth";
const ACTIVE_COOKIE = "truck_active";
const SESSION_MS = 30 * 86400 * 1000;
/** Trucks one browser can stay signed in to at the same time (quick switching). */
const MAX_BROWSER_SESSIONS = 6;
/** Kept moderate so a login stays within the Workers Free CPU budget. */
const PBKDF2_ITERATIONS = 20000;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const SLUG = /^[a-z0-9-]{3,40}$/;

let ready: Promise<void> | null = null;
const slugCache = new Map<string, { account: TruckAccount | null; at: number }>();

const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], pair => Number.parseInt(pair, 16));

async function derive(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations }, key, 256));
}
async function hashPassword(password: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { hash: await derive(password, salt, PBKDF2_ITERATIONS), salt, iterations: PBKDF2_ITERATIONS };
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function toAccount(row: AccountRow): TruckAccount {
  return { id: row.id, slug: row.slug, name: row.name, username: row.username, flagship: row.flagship === 1, createdAt: row.created_at };
}

/** Creates the account tables on first use and the flagship account (海海人生) when it is missing. */
export function ensureAccounts(env: Env): Promise<void> {
  ready ??= (async () => {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS truck_accounts (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, flagship INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS truck_account_sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS truck_account_sessions_account ON truck_account_sessions (account_id)")
    ]);
    const present = await env.DB.prepare("SELECT id FROM truck_accounts WHERE id = ?").bind(FLAGSHIP.id).first();
    if (!present) {
      const secret = await hashPassword(env.TRUCK_FLAGSHIP_PASSWORD || env.TRUCK_MERCHANT_KEY || DEFAULT_FLAGSHIP_PASSWORD);
      await env.DB.prepare("INSERT OR IGNORE INTO truck_accounts (id, slug, name, username, password_hash, salt, iterations, flagship, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)")
        .bind(FLAGSHIP.id, FLAGSHIP.slug, FLAGSHIP.name, FLAGSHIP.username, secret.hash, secret.salt, secret.iterations, new Date().toISOString()).run();
    }
  })().catch(error => { ready = null; throw error; });
  return ready;
}

export async function accountBySlug(env: Env, slug: string): Promise<TruckAccount | null> {
  if (!SLUG.test(slug)) return null;
  const cached = slugCache.get(slug);
  if (cached && Date.now() - cached.at < 60000) return cached.account;
  const row = await env.DB.prepare("SELECT id, slug, name, username, flagship, created_at FROM truck_accounts WHERE slug = ?").bind(slug).first<AccountRow>();
  const account = row ? toAccount(row) : null;
  slugCache.set(slug, { account, at: Date.now() });
  return account;
}

/** Up to 40 most recently created accounts (daily maintenance). */
export async function listAccounts(env: Env, limit = 40): Promise<TruckAccount[]> {
  const rows = await env.DB.prepare("SELECT id, slug, name, username, flagship, created_at FROM truck_accounts ORDER BY flagship DESC, created_at DESC LIMIT ?").bind(limit).all<AccountRow>();
  return rows.results.map(toAccount);
}
export async function countAccounts(env: Env): Promise<number> {
  return Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM truck_accounts").first<{ count: number }>())?.count || 0);
}

function readCookie(request: Request, name: string): string {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1] || "";
}
function cookieTokens(request: Request): string[] {
  return [...new Set(readCookie(request, AUTH_COOKIE).split(".").filter(token => /^[a-f0-9]{64}$/.test(token)))].slice(-MAX_BROWSER_SESSIONS);
}
export function activeSlug(request: Request): string {
  const value = readCookie(request, ACTIVE_COOKIE);
  return SLUG.test(value) ? value : "";
}

/** Every truck this browser is signed in to, in sign-in order. */
export async function resolveSessions(env: Env, request: Request): Promise<TruckSession[]> {
  const tokens = cookieTokens(request);
  if (!tokens.length) return [];
  const ids = await Promise.all(tokens.map(sha256Hex));
  const rows = await env.DB.prepare(`SELECT s.id AS sid, s.expires, a.id, a.slug, a.name, a.username, a.flagship, a.created_at FROM truck_account_sessions s JOIN truck_accounts a ON a.id = s.account_id WHERE s.id IN (${ids.map(() => "?").join(",")}) AND s.expires > ?`)
    .bind(...ids, Date.now()).all<AccountRow & { sid: string; expires: number }>();
  const byId = new Map(rows.results.map(row => [row.sid, row]));
  return tokens.flatMap((token, index) => {
    const row = byId.get(ids[index]!);
    return row ? [{ id: row.sid, token, expires: row.expires, account: toAccount(row) }] : [];
  });
}

/** The session a merchant request acts as: an explicit workspace wins, then the active cookie, then the first sign-in. */
export function pickSession(sessions: TruckSession[], request: Request): TruckSession | null {
  const url = new URL(request.url);
  const wanted = request.headers.get("x-truck-workspace") || url.searchParams.get("workspace") || "";
  if (wanted) return sessions.find(session => session.account.slug === wanted) ?? null;
  const active = activeSlug(request);
  return sessions.find(session => session.account.slug === active) ?? sessions[0] ?? null;
}

function secure(request: Request, env: Env): string {
  const https = truckOrigin(env)?.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
  return https ? "; Secure" : "";
}
function cookieHeaders(request: Request, env: Env, tokens: string[], active: string): Headers {
  const flags = `; Path=/api/truck/; HttpOnly; SameSite=Lax${secure(request, env)}`;
  const age = tokens.length ? Math.floor(SESSION_MS / 1000) : 0;
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  headers.append("set-cookie", `${AUTH_COOKIE}=${tokens.join(".")}; Max-Age=${age}${flags}`);
  headers.append("set-cookie", `${ACTIVE_COOKIE}=${active}; Max-Age=${active ? age : 0}${flags}`);
  return headers;
}
const view = (account: TruckAccount) => ({ slug: account.slug, name: account.name, username: account.username, flagship: account.flagship });

async function createSession(env: Env, account: TruckAccount): Promise<{ token: string; id: string; expires: number }> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256Hex(token);
  const expires = Date.now() + SESSION_MS;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM truck_account_sessions WHERE expires <= ?").bind(Date.now()),
    env.DB.prepare("INSERT INTO truck_account_sessions (id, account_id, expires, created_at) VALUES (?, ?, ?, ?)").bind(id, account.id, expires, Date.now())
  ]);
  return { token, id, expires };
}
/** Adds a sign-in to this browser's list (replacing an older one for the same truck) and makes it active. */
async function signIn(request: Request, env: Env, account: TruckAccount): Promise<Response> {
  const existing = await resolveSessions(env, request);
  const session = await createSession(env, account);
  const others = existing.filter(row => row.account.id !== account.id);
  const replaced = existing.filter(row => row.account.id === account.id).map(row => row.id);
  if (replaced.length) await env.DB.prepare(`DELETE FROM truck_account_sessions WHERE id IN (${replaced.map(() => "?").join(",")})`).bind(...replaced).run();
  const tokens = [...others.map(row => row.token), session.token].slice(-MAX_BROWSER_SESSIONS);
  const accounts = [...others.map(row => row.account), account].slice(-MAX_BROWSER_SESSIONS);
  return new Response(JSON.stringify({ success: true, account: view(account), accounts: accounts.map(view), active: account.slug }), { headers: cookieHeaders(request, env, tokens, account.slug) });
}

function field(value: unknown, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new HttpError(`請填寫${label}。`, 400);
  if (text.length > max) throw new HttpError(`${label}最多 ${max} 個字。`, 400);
  return text;
}
function passwordRule(value: unknown): string {
  const password = typeof value === "string" ? value : "";
  if (password.length < 8 || password.length > 128) throw new HttpError("密碼需為 8 至 128 個字元。", 400);
  return password;
}

export type WorkspaceNotifier = (account: TruckAccount, path: string, body: Record<string, unknown>) => Promise<void>;

/** /api/truck/session (GET sign-ins, POST login, DELETE logout), /session/switch, /register, /account/password. */
export async function handleAccountRoute(request: Request, env: Env, notify: WorkspaceNotifier): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!["/api/truck/session", "/api/truck/session/switch", "/api/truck/register", "/api/truck/account/password"].includes(path)) return null;
  if (request.method !== "GET") requireTruckOrigin(request, env);

  if (path === "/api/truck/session" && request.method === "GET") {
    const sessions = await resolveSessions(env, request);
    const active = pickSession(sessions, request);
    return truckJson({ success: true, accounts: sessions.map(row => view(row.account)), active: active?.account.slug || null });
  }
  if (path === "/api/truck/session" && request.method === "POST") {
    const body = await truckBody(request, 2048);
    const username = field(body.username, "帳號", 64).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const row = await env.DB.prepare("SELECT id, slug, name, username, flagship, created_at, password_hash, salt, iterations FROM truck_accounts WHERE username = ?").bind(username)
      .first<AccountRow & { password_hash: string; salt: string; iterations: number }>();
    // Always derive once, so an unknown username costs the same as a wrong password.
    const derived = await derive(password, row?.salt || "00".repeat(16), row?.iterations || PBKDF2_ITERATIONS);
    if (!row || !sameText(derived, row.password_hash)) throw new HttpError("帳號或密碼不正確。", 401);
    return signIn(request, env, toAccount(row));
  }
  if (path === "/api/truck/session/switch" && request.method === "POST") {
    const body = await truckBody(request, 1024);
    const sessions = await resolveSessions(env, request);
    const target = sessions.find(row => row.account.slug === body.slug);
    if (!target) throw new HttpError("請先登入這台餐車的帳號。", 401);
    return new Response(JSON.stringify({ success: true, account: view(target.account), accounts: sessions.map(row => view(row.account)), active: target.account.slug }), { headers: cookieHeaders(request, env, sessions.map(row => row.token), target.account.slug) });
  }
  if (path === "/api/truck/session" && request.method === "DELETE") {
    const sessions = await resolveSessions(env, request);
    const all = url.searchParams.get("all") === "1";
    const current = pickSession(sessions, request);
    const ended = all ? sessions : current ? [current] : [];
    if (ended.length) await env.DB.prepare(`DELETE FROM truck_account_sessions WHERE id IN (${ended.map(() => "?").join(",")})`).bind(...ended.map(row => row.id)).run();
    await Promise.all(ended.map(row => notify(row.account, "/internal/revoke", { session: row.id }).catch(() => undefined)));
    const remaining = sessions.filter(row => !ended.includes(row));
    const next = remaining.at(-1)?.account.slug || "";
    return new Response(JSON.stringify({ success: true, accounts: remaining.map(row => view(row.account)), active: next || null }), { headers: cookieHeaders(request, env, remaining.map(row => row.token), next) });
  }
  if (path === "/api/truck/register" && request.method === "POST") {
    const body = await truckBody(request, 4096);
    const name = field(body.storeName, "店名", 40);
    const username = field(body.username, "帳號", 32).toLowerCase();
    if (!USERNAME.test(username)) throw new HttpError("帳號需為 3 至 32 個英文小寫、數字或 . _ - 符號，並以英文或數字開頭。", 400);
    const password = passwordRule(body.password);
    if (await env.DB.prepare("SELECT 1 AS taken FROM truck_accounts WHERE username = ?").bind(username).first()) throw new HttpError("這個帳號已經有人使用，請換一個。", 409);
    const secret = await hashPassword(password);
    const id = `acct-${crypto.randomUUID()}`;
    const slug = `t${hex(crypto.getRandomValues(new Uint8Array(5)))}`;
    const createdAt = new Date().toISOString();
    try {
      await env.DB.prepare("INSERT INTO truck_accounts (id, slug, name, username, password_hash, salt, iterations, flagship, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)")
        .bind(id, slug, name, username, secret.hash, secret.salt, secret.iterations, createdAt).run();
    } catch {
      throw new HttpError("這個帳號已經有人使用，請換一個。", 409);
    }
    slugCache.delete(slug);
    return signIn(request, env, { id, slug, name, username, flagship: false, createdAt });
  }
  if (path === "/api/truck/account/password" && request.method === "POST") {
    const session = pickSession(await resolveSessions(env, request), request);
    if (!session) throw new HttpError("請先登入商家工作台。", 401);
    const body = await truckBody(request, 2048);
    const next = passwordRule(body.next);
    const row = await env.DB.prepare("SELECT password_hash, salt, iterations FROM truck_accounts WHERE id = ?").bind(session.account.id).first<{ password_hash: string; salt: string; iterations: number }>();
    if (!row || !sameText(await derive(typeof body.current === "string" ? body.current : "", row.salt, row.iterations), row.password_hash)) throw new HttpError("目前的密碼不正確。", 401);
    const secret = await hashPassword(next);
    await env.DB.batch([
      env.DB.prepare("UPDATE truck_accounts SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?").bind(secret.hash, secret.salt, secret.iterations, session.account.id),
      // Other browsers signed in to this truck are signed out; this one stays signed in.
      env.DB.prepare("DELETE FROM truck_account_sessions WHERE account_id = ? AND id != ?").bind(session.account.id, session.id)
    ]);
    return truckJson({ success: true });
  }
  return truckJson({ success: false, error: "找不到帳號功能。" }, 404);
}

/** Keeps the account name in step with the store name edited in workspace settings. */
export async function renameAccount(env: Env, accountId: string, name: string): Promise<void> {
  await env.DB.prepare("UPDATE truck_accounts SET name = ? WHERE id = ?").bind(name.slice(0, 60), accountId).run();
  slugCache.clear();
}
