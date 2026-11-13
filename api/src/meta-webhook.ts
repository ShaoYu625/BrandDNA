import { bodyBytes } from "./routes/truck";
import { HttpError, type Env } from "./schema";
import { matchesSecret } from "./truck-auth";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };

function reply(message: string, status = 200): Response {
  return new Response(message, { status, headers });
}

export async function handleMetaWebhook(request: Request, env: Env): Promise<Response> {
  const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN;
  const secret = env.META_APP_SECRET;
  if (!secret || !verifyToken || verifyToken.length < 32) return reply("Not configured", 404);

  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const challenge = params.get("hub.challenge") ?? "";
    const suppliedToken = params.get("hub.verify_token") ?? "";
    if (params.get("hub.mode") !== "subscribe" || !/^\d{1,32}$/.test(challenge)) return reply("Invalid challenge", 400);
    return await matchesSecret(suppliedToken, verifyToken) ? reply(challenge) : reply("Forbidden", 403);
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { ...headers, allow: "GET, POST" } });
  }
  const signature = request.headers.get("x-hub-signature-256")?.match(/^sha256=([0-9a-f]{64})$/i)?.[1];
  if (!signature) return reply("Forbidden", 403);

  let body: Uint8Array<ArrayBuffer>;
  try { body = await bodyBytes(request, MAX_WEBHOOK_BYTES); }
  catch (error) {
    return error instanceof HttpError && error.status === 413 ? reply("Payload too large", 413) : reply("Invalid body", 400);
  }

  const bytes = Uint8Array.from(signature.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", key, bytes, body))) return reply("Forbidden", 403);

  // The demo polls for insights. Webhook payloads are verified and discarded.
  return reply("OK");
}
