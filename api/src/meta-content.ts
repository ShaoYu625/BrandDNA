
import type { Env } from "./schema";
import { HttpError } from "./schema";
import type { Metrics, Post } from "./routes/truck";
import {
  graph, graphDate, graphNumber, graphObject, graphRows, graphString, nextCursor, publicPermalink, remoteId,
  GraphError, type GraphObject, type MetaConfig, type MetaPlatform,
} from "./meta-graph";

const APPROVAL_AGE_MS = 60 * 60 * 1000;
const JPEG_SIZE = 1080;

export function isPublicationJpeg(bytes: Uint8Array): boolean {
  if (bytes[0] !== 255 || bytes[1] !== 216) return false;
  // Scan JPEG segments up to the start of scan. Canvas produces an RGB, square JPEG.
  let offset = 2;
  while (bytes[offset] === 255) {
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 8 > bytes.length) return false;
    const length = (bytes[offset]! << 8) + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker === 0xc0 || marker === 0xc2) {
      return length >= 17 && bytes[offset + 2] === 8 && bytes[offset + 7] === 3
        && ((bytes[offset + 3]! << 8) + bytes[offset + 4]!) === JPEG_SIZE
        && ((bytes[offset + 5]! << 8) + bytes[offset + 6]!) === JPEG_SIZE;
    }
    offset += length;
  }
  return false;
}

export async function verifyPublicationPhoto(env: Env, value: unknown): Promise<string> {
  const image = typeof value === "string" ? value : "";
  const key = image.match(/^\/api\/truck\/media\/([a-f0-9-]{36}\.jpg)$/)?.[1];
  if (key) {
    const cutoff = Date.now() - APPROVAL_AGE_MS;
    if (env.BUCKET) {
      const photo = await env.BUCKET.get("truck-media/" + key, { range: { offset: 0, length: 131072 } });
      if (photo?.httpMetadata?.contentType === "image/jpeg" && photo.uploaded.getTime() >= cutoff
          && isPublicationJpeg(new Uint8Array(await photo.arrayBuffer()))) return image;
    } else {
      const photo = await env.DB.prepare(
        "SELECT m.created_at, c.body FROM truck_media m JOIN truck_media_chunks c ON c.media_id = m.id WHERE m.id = ? AND m.content_type = 'image/jpeg' AND c.chunk_index = 0",
      ).bind(key).first<{ created_at: string; body: number[] }>();
      if (photo && Date.parse(photo.created_at) >= cutoff && isPublicationJpeg(new Uint8Array(photo.body))) return image;
    }
  }
  throw new HttpError("請重新產生並上傳 1080 × 1080 的發布用 JPEG。", 400);
}

function mediaLink(value: unknown): string {
  try {
    const url = new URL(graphString(value, 4096));
    if (url.protocol === "https:" && !url.username && !url.password && !url.searchParams.has("access_token")
        && /(?:^|\.)(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com)$/.test(url.hostname)) return url.href;
  } catch { /* Unsupported or unavailable media URL. */ }
  return "";
}

export function reconciliationMatch(original: Post, candidate: Post): boolean {
  if (original.meta?.status !== "unknown" || !original.meta.attemptedAt || !candidate.meta?.imported || !candidate.meta.remoteId
    || original.platform !== candidate.platform || original.meta.accountId !== candidate.meta.accountId || original.caption.trim() !== candidate.caption.trim()) return false;
  const elapsed = Date.parse(candidate.publishedAt || "") - Date.parse(original.meta.attemptedAt);
  return elapsed >= -5 * 60 * 1000 && elapsed <= 24 * 3600 * 1000;
}

export async function fetchOwnedPosts(config: MetaConfig, platform: MetaPlatform, account: { id: string; name: string }, token: string, cursor: string) {
  const isIg = platform === "instagram";
  const query: Record<string, string> = {
    fields: isIg ? "id,caption,permalink,timestamp,media_type,media_url,thumbnail_url" : "id,message,permalink_url,created_time,attachments.limit(1){media}",
    limit: "20",
  };
  if (cursor) query.after = cursor;
  const result = await graph(config, account.id + (isIg ? "/media" : "/posts"), query, token);
  const posts: Post[] = [];
  for (const row of graphRows(result.data).slice(0, 20)) {
    const id = remoteId(row.id);
    const publishedAt = graphDate(isIg ? row.timestamp : row.created_time);
    if (!id || !publishedAt) continue;
    const caption = graphString(isIg ? row.caption : row.message, 10000);
    const attachment = graphRows(graphObject(row.attachments).data)[0];
    const thumbnail = isIg ? mediaLink(row.media_type === "VIDEO" ? row.thumbnail_url : row.media_url)
      : mediaLink(graphObject(graphObject(attachment?.media).image).src);
    posts.push({
      id: "meta-" + platform + "-" + account.id + "-" + id,
      platform, title: caption.trim().split("\n")[0]?.slice(0, 80) || "社群既有貼文", topic: "", caption,
      image: "", cardTitle: "", status: "published", createdAt: publishedAt, publishedAt, scheduledAt: null,
      mode: "meta", metrics: null,
      meta: {
        accountId: account.id, accountName: account.name, status: "published", remoteId: id,
        permalink: publicPermalink(isIg ? row.permalink : row.permalink_url, platform), imported: true,
        ...(thumbnail ? { thumbnail } : {}),
      },
    });
  }
  return { posts, cursor: nextCursor(result) };
}

function insightValues(result: GraphObject): Map<string, number | null> {
  return new Map(graphRows(result.data).map(row => {
    const values = graphRows(row.values);
    const value = values.at(-1)?.value ?? graphObject(row.total_value).value;
    return [graphString(row.name), graphNumber(value)];
  }));
}

function graphSummary(value: unknown): number | null {
  return graphNumber(graphObject(graphObject(value).summary).total_count);
}

export async function mediaInsights(config: MetaConfig, platform: MetaPlatform, id: string, token: string): Promise<Metrics> {
  const fetchedAt = new Date().toISOString();
  let reach: number | null = null;
  let likes: number | null = null;
  let comments: number | null = null;
  let saves: number | null = null;
  let shares: number | null = null;
  let views: number | null = null;
  if (platform === "instagram") {
    const result = await graph(config, id + "/insights", { metric: "reach,likes,comments,saved,views,shares" }, token);
    const values = insightValues(result);
    reach = values.get("reach") ?? null;
    likes = values.get("likes") ?? null;
    comments = values.get("comments") ?? null;
    saves = values.get("saved") ?? null;
    shares = values.get("shares") ?? null;
    views = values.get("views") ?? null;
  } else {
    const counts = await graph(config, id, {
      fields: "reactions.type(LIKE).limit(0).summary(total_count).as(likes),comments.limit(0).summary(true),shares",
    }, token);
    likes = graphSummary(counts.likes);
    comments = graphSummary(counts.comments);
    shares = graphNumber(graphObject(counts.shares).count);
    try {
      const insights = await graph(config, id + "/insights", { metric: "post_total_media_view_unique,post_media_view" }, token);
      const values = insightValues(insights);
      reach = values.get("post_total_media_view_unique") ?? null;
      views = values.get("post_media_view") ?? null;
    } catch (error) {
      // A Page role or older post may allow counts but not these insight metrics.
      if (!(error instanceof GraphError) || error.retryable || error.code === 190 || error.code === 102) throw error;
      return { reach, likes, comments, saves, clicks: null, views, shares, fetchedAt, period: "lifetime",
        reason: "此粉專或貼文無法讀取觸及與瀏覽洞察。FB 收藏與每篇連結點擊目前不適用。" };
    }
  }
  return { reach, likes, comments, saves, clicks: null, views, shares, fetchedAt, period: "lifetime",
    reason: "空白表示 Meta 未回傳或媒體不支援。每篇連結點擊目前不適用。" };
}
