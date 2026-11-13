import { AppContext, HttpError, sanitizeFilename, utcNow } from "../schema";

const MAX_OBJECT_BYTES = 5 * 1024 * 1024;
const MAX_STORAGE_BYTES = 50 * 1024 * 1024;
const CHUNK_BYTES = 128 * 1024;

export interface StoredObject {
  body: ReadableStream;
  httpEtag: string;
  httpMetadata?: R2HTTPMetadata;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  writeHttpMetadata(headers: Headers): void;
}

export class R2Adapter {
  readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  private get useD1(): boolean { return this.ctx.env.OBJECT_STORAGE === "d1" || !this.ctx.env.BUCKET; }

  /** Reserve headroom before a paid image call; the write transaction also enforces the limit. */
  async ensureWriteCapacity(size = MAX_OBJECT_BYTES): Promise<void> {
    if (!this.useD1) return;
    if (size > MAX_OBJECT_BYTES) throw new HttpError("展示版單檔上限為 5 MB，請先壓縮圖片或檔案。", 413);
    const row = await this.ctx.env.DB.prepare("SELECT bytes_used FROM app_storage_usage WHERE id = 1").first<{bytes_used: number}>();
    if (Number(row?.bytes_used || 0) + size > MAX_STORAGE_BYTES) throw new HttpError("展示版檔案空間已滿，請先整理檔案後再試。", 413);
  }

  async putBytes(key: string, bytes: ArrayBuffer | Uint8Array, contentType = "application/octet-stream"): Promise<string> {
    if (!this.useD1 && this.ctx.env.BUCKET) {
      await this.ctx.env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { created_at: utcNow() }
      });
      return key;
    }
    const data = Uint8Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (data.byteLength > MAX_OBJECT_BYTES) throw new HttpError("展示版單檔上限為 5 MB，請先壓縮圖片或檔案。", 413);
    const etag = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), n => n.toString(16).padStart(2, "0")).join("");
    const db = this.ctx.env.DB;
    const statements = [
      db.prepare("UPDATE app_storage_usage SET bytes_used = bytes_used + ? - COALESCE((SELECT size FROM app_objects WHERE key = ?), 0) WHERE id = 1").bind(data.byteLength, key),
      db.prepare("DELETE FROM app_object_chunks WHERE object_key = ?").bind(key),
      db.prepare("INSERT INTO app_objects (key, content_type, size, etag, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET content_type=excluded.content_type, size=excluded.size, etag=excluded.etag, created_at=excluded.created_at").bind(key, contentType, data.byteLength, etag, utcNow())
    ];
    // Eight chunks per statement: a 5 MiB file uses eight statements including bookkeeping.
    for (let start = 0; start < data.byteLength; start += CHUNK_BYTES * 8) {
      const placeholders: string[] = [];
      const values: (string | number | ArrayBuffer)[] = [];
      for (let offset = start; offset < Math.min(start + CHUNK_BYTES * 8, data.byteLength); offset += CHUNK_BYTES) {
        placeholders.push("(?, ?, ?)");
        values.push(key, offset / CHUNK_BYTES, data.slice(offset, offset + CHUNK_BYTES).buffer);
      }
      statements.push(db.prepare(`INSERT INTO app_object_chunks (object_key, chunk_index, body) VALUES ${placeholders.join(",")}`).bind(...values));
    }
    try { await db.batch(statements); }
    catch (error) {
      if (/CHECK constraint failed.*bytes_used/i.test(String(error))) throw new HttpError("展示版檔案空間已滿，請先整理檔案後再試。", 413);
      throw error;
    }
    return key;
  }

  async putText(key: string, text: string, contentType = "text/plain; charset=utf-8"): Promise<string> {
    return this.putBytes(key, new TextEncoder().encode(text), contentType);
  }

  async putFile(prefix: string, file: File): Promise<{ key: string; filename: string; contentType: string; size: number }> {
    const filename = uniqueStoredFilename(file.name || "upload.bin");
    const key = `${prefix.replace(/\/+$/, "")}/${filename}`;
    await this.putBytes(key, await file.arrayBuffer(), file.type || "application/octet-stream");
    return { key, filename, contentType: file.type || "application/octet-stream", size: file.size };
  }

  async getText(key: string): Promise<string> {
    const object = await this.getObject(key);
    if (!object) throw new Error("R2 object not found.");
    return await object.text();
  }

  /** Only called by the user's explicit workspace reset; unrelated brands are preserved. */
  async deleteBrandObjects(brandId: number): Promise<void> {
    if (!this.useD1) return;
    const where = "key LIKE ? OR key LIKE ? OR key LIKE ? OR key LIKE ?";
    const prefixes = ["uploads", "rawdata", "generated-images", "artifacts"].map(prefix => `${prefix}/${brandId}/%`);
    const db = this.ctx.env.DB;
    await db.batch([
      db.prepare(`UPDATE app_storage_usage SET bytes_used = bytes_used - (SELECT COALESCE(SUM(size), 0) FROM app_objects WHERE ${where}) WHERE id = 1`).bind(...prefixes),
      db.prepare(`DELETE FROM app_objects WHERE ${where}`).bind(...prefixes)
    ]);
  }

  async getObject(key: string): Promise<StoredObject | null> {
    if (!this.useD1 && this.ctx.env.BUCKET) return this.ctx.env.BUCKET.get(key);
    const db = this.ctx.env.DB;
    // One SELECT keeps metadata and chunks at the same database snapshot during overwrites.
    const result = await db.prepare("SELECT o.content_type, o.size, o.etag, c.body FROM app_objects o LEFT JOIN app_object_chunks c ON c.object_key = o.key WHERE o.key = ? ORDER BY c.chunk_index").bind(key).all<{content_type: string; size: number; etag: string; body: number[] | null}>();
    const meta = result.results[0];
    if (!meta) return null;
    const data = new Uint8Array(meta.size);
    let offset = 0;
    for (const row of result.results) { if (row.body === null) continue; const chunk = Uint8Array.from(row.body); data.set(chunk, offset); offset += chunk.byteLength; }
    if (offset !== meta.size) throw new Error("儲存檔案不完整，請重新上傳。");
    const response = new Response(data);
    return {
      body: response.body!, httpEtag: `"${meta.etag}"`, httpMetadata: {contentType: meta.content_type},
      arrayBuffer: async () => data.slice().buffer,
      text: async () => new TextDecoder().decode(data),
      writeHttpMetadata: headers => { headers.set("content-type", meta.content_type); headers.set("content-length", String(meta.size)); }
    };
  }
}

export function uniqueStoredFilename(filename: string): string {
  const safe = sanitizeFilename(filename);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${stamp}_${crypto.randomUUID().slice(0, 8)}_${safe}`;
}

export function publicArtifactUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const filename = key.split("/").filter(Boolean).pop();
  return filename ? `/artifacts/${filename}` : null;
}
