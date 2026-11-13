import { AppContext, JsonRecord } from "../schema";

export async function browserFetchHtml(ctx: AppContext, url: string): Promise<{ html: string; screenshotBytes?: ArrayBuffer; contentType?: string; metadata: JsonRecord }> {
  const browser = ctx.env.BROWSER;
  if (!browser?.quickAction) {
    return { html: "", metadata: { browser_run: "unavailable" } };
  }
  try {
    const response = await browser.quickAction("html", { url });
    if (!response.ok) {
      return { html: "", metadata: { browser_run: "failed", status: response.status } };
    }
    return { html: await response.text(), metadata: { browser_run: "html_quick_action" } };
  } catch (error) {
    return { html: "", metadata: { browser_run: "failed", error: String(error) } };
  }
}

export async function browserScreenshot(ctx: AppContext, url: string): Promise<{ bytes?: ArrayBuffer; contentType?: string; metadata: JsonRecord }> {
  const browser = ctx.env.BROWSER;
  if (!browser?.quickAction) return { metadata: { browser_run: "unavailable" } };
  try {
    const response = await browser.quickAction("screenshot", { url });
    if (!response.ok) return { metadata: { browser_run: "screenshot_failed", status: response.status } };
    return {
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") || "image/png",
      metadata: { browser_run: "screenshot_quick_action" }
    };
  } catch (error) {
    return { metadata: { browser_run: "screenshot_failed", error: String(error) } };
  }
}
