interface Env {
  API_WORKER_ORIGIN?: string;
  LEGACY_API_WORKER_ORIGIN?: string;
}

type PagesContext = EventContext<Env, string, Record<string, unknown>>;

export const onRequest: PagesFunction<Env> = async (context: PagesContext): Promise<Response> => {
  return proxyToApiWorker(context);
};

async function proxyToApiWorker(context: PagesContext): Promise<Response> {
  const incomingUrl = new URL(context.request.url);
  const isTruck = incomingUrl.pathname.startsWith('/api/truck/');
  const origin = ((isTruck ? context.env.API_WORKER_ORIGIN : context.env.LEGACY_API_WORKER_ORIGIN || context.env.API_WORKER_ORIGIN) || "http://127.0.0.1:8787").replace(/\/+$/, "");
  const targetUrl = `${origin}${incomingUrl.pathname}${incomingUrl.search}`;
  const headers = new Headers(context.request.headers);
  headers.set("X-Forwarded-Host", incomingUrl.host);
  headers.set("X-Forwarded-Proto", incomingUrl.protocol.replace(":", ""));
  headers.delete("host");

  const proxied = new Request(targetUrl, {
    method: context.request.method,
    headers,
    body: context.request.body,
    redirect: "manual"
  });
  const response = await fetch(proxied);
  // Preserve Set-Cookie, redirects and WebSocket upgrade responses from the Worker.
  if (incomingUrl.pathname !== "/api/truck/meta/callback") return response;
  const callbackHeaders = new Headers(response.headers);
  callbackHeaders.set("cache-control", "no-store");
  callbackHeaders.set("referrer-policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers: callbackHeaders });
}
