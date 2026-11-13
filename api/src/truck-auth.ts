
import { Env, HttpError } from "./schema";

export function truckJson(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function truckBody(request: Request, limit = 8192): Promise<Record<string, unknown>> {
  return readObject(request, limit);
}

async function readObject(request: Request, limit: number): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    if (!reader || !request.headers.get("content-type")?.startsWith("application/json")) throw new Error();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new HttpError("操作資料太大。", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    const result: unknown = JSON.parse(body + decoder.decode());
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("操作資料不是有效的 JSON。", 400);
  }
}

export function truckOrigin(env: Env): URL | null {
  try {
    const url = new URL(env.TRUCK_PUBLIC_ORIGIN || "");
    const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || loopback) && !url.username && !url.password && url.href === url.origin + "/" ? url : null;
  } catch { return null; }
}

/**
 * Cross-site protection for merchant writes and sockets. With TRUCK_PUBLIC_ORIGIN configured the Origin must match it
 * exactly; otherwise a browser Origin must be the host the request was sent to (directly or through the Pages proxy).
 */
export function requireTruckOrigin(request: Request, env: Env): void {
  const supplied = request.headers.get("origin");
  const configured = truckOrigin(env);
  if (configured) {
    if (supplied !== configured.origin) throw new HttpError("請從設定的工作台網址操作。", 403);
    return;
  }
  if (!supplied) return;
  let host = "";
  try { host = new URL(supplied).host; } catch { /* rejected below */ }
  const allowed = [request.headers.get("x-forwarded-host"), new URL(request.url).host].filter(Boolean);
  if (!host || !allowed.includes(host)) throw new HttpError("請從工作台網址操作。", 403);
}

async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
export const sha256Hex = hash;

export async function matchesSecret(supplied: string, expected: string): Promise<boolean> {
  const [suppliedHash, expectedHash] = await Promise.all([hash(supplied), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < expectedHash.length; i++) difference |= suppliedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return difference === 0;
}

/**
 * Merchant sessions as seen inside a workspace Durable Object. The Worker authenticates the browser against the D1
 * account table and forwards the session id; the object keeps a mirror so long-running Meta flows can re-check that
 * the session is still signed in after every await.
 */
export class TruckAuth {
  constructor(private readonly sql: SqlStorage) {}

  initialize(): void {
    this.sql.exec("CREATE TABLE IF NOT EXISTS truck_sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
  }

  /** Every merchant route is signed in. */
  get required(): boolean { return true; }

  touch(id: string, expires: number): void {
    if (!/^[a-f0-9]{64}$/.test(id) || !Number.isFinite(expires) || expires <= Date.now()) return;
    this.sql.exec("INSERT INTO truck_sessions (id, expires) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET expires = excluded.expires", id, expires);
    if (Math.random() < 0.05) this.sql.exec("DELETE FROM truck_sessions WHERE expires <= ?", Date.now());
  }

  active(id: string | null): boolean {
    return Boolean(id && this.sql.exec("SELECT 1 FROM truck_sessions WHERE id = ? AND expires > ?", id, Date.now()).toArray().length);
  }

  revoke(id: string): void {
    this.sql.exec("DELETE FROM truck_sessions WHERE id = ?", id);
  }
}
