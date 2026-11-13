import type { TruckState } from "./routes/truck";

/**
 * Row layout for the workspace inside the Durable Object's SQLite storage.
 * Each record (order, post, source…) is its own row, so an action rewrites only the rows it touched
 * instead of the whole workspace, and no single row can approach SQLite's 2 MB limit.
 */
type Order = "desc" | "asc";
export const COLLECTIONS: ReadonlyArray<readonly [CollectionName, Order]> = [
  ["sources", "desc"], ["posts", "desc"], ["stalls", "asc"], ["menu", "asc"],
  ["orders", "desc"], ["members", "desc"], ["coupons", "desc"], ["campaigns", "desc"], ["activity", "desc"]
];
export const SINGLETONS = ["brand", "archetypes", "diagnosis", "trends", "assistant", "settings", "workspace"] as const;
type CollectionName = "sources" | "posts" | "stalls" | "menu" | "orders" | "members" | "coupons" | "campaigns" | "activity";

export interface StoredItem { col: string; id: string; seq: number; json: string }
export interface PersistIndex {
  items: Map<string, { seq: number; json: string }>;
  meta: Map<string, string>;
  nextSeq: number;
}
export interface PersistPlan {
  meta: [string, string][];
  upserts: StoredItem[];
  deletes: { col: string; id: string }[];
  index: PersistIndex;
}

const itemKey = (col: string, id: string) => `${col}\u0000${id}`;
export function emptyIndex(): PersistIndex { return { items: new Map(), meta: new Map(), nextSeq: 1 }; }

/**
 * Diff the next state against what is already stored. Array order is encoded in `seq`:
 * newest-first collections give new rows a higher seq (they were unshifted), append-only
 * collections give new rows a higher seq at the end. Existing rows keep their seq.
 */
export function planPersist(previous: PersistIndex, next: TruckState): PersistPlan {
  const index: PersistIndex = { items: new Map(previous.items), meta: new Map(previous.meta), nextSeq: previous.nextSeq };
  const plan: PersistPlan = { meta: [], upserts: [], deletes: [], index };
  const setMeta = (key: string, value: string) => {
    if (index.meta.get(key) === value) return;
    index.meta.set(key, value); plan.meta.push([key, value]);
  };
  for (const name of SINGLETONS) setMeta(name, JSON.stringify(next[name]));
  setMeta("revision", String(next.revision));

  for (const [col, order] of COLLECTIONS) {
    const rows = next[col] as { id: string }[];
    const live = new Set<string>();
    const sequence = order === "desc" ? [...rows].reverse() : rows;
    // A reordered collection (e.g. menu items moved up/down) no longer matches the stored seq order: renumber it.
    let last = -1;
    let reorder = false;
    for (const row of sequence) {
      const stored = index.items.get(itemKey(col, row.id));
      if (!stored) continue;
      if (stored.seq <= last) { reorder = true; break; }
      last = stored.seq;
    }
    for (const row of sequence) {
      const key = itemKey(col, row.id);
      live.add(key);
      const json = JSON.stringify(row);
      const stored = index.items.get(key);
      if (stored && stored.json === json && !reorder) continue;
      const seq = stored && !reorder ? stored.seq : index.nextSeq++;
      index.items.set(key, { seq, json });
      plan.upserts.push({ col, id: row.id, seq, json });
    }
    for (const key of [...index.items.keys()]) {
      if (!key.startsWith(`${col}\u0000`) || live.has(key)) continue;
      index.items.delete(key);
      plan.deletes.push({ col, id: key.slice(col.length + 1) });
    }
  }
  setMeta("nextSeq", String(index.nextSeq));
  return plan;
}

/** Rebuild the in-memory workspace (and the diff index) after the object wakes from hibernation or eviction. */
export function rebuildState(metaRows: { k: string; v: string }[], itemRows: StoredItem[]): { state: TruckState; index: PersistIndex } | null {
  const meta = new Map(metaRows.map(row => [row.k, row.v]));
  if (!meta.has("revision")) return null;
  const index: PersistIndex = { items: new Map(), meta, nextSeq: Number(meta.get("nextSeq")) || 1 };
  const state = { revision: Number(meta.get("revision")) || 0 } as TruckState;
  for (const name of SINGLETONS) (state as unknown as Record<string, unknown>)[name] = JSON.parse(meta.get(name) || "null");
  for (const [col, order] of COLLECTIONS) {
    const rows = itemRows.filter(row => row.col === col).sort((a, b) => order === "desc" ? b.seq - a.seq : a.seq - b.seq);
    for (const row of rows) index.items.set(itemKey(col, row.id), { seq: row.seq, json: row.json });
    (state as unknown as Record<string, unknown>)[col] = rows.map(row => JSON.parse(row.json));
  }
  state.stalls.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  return { state, index };
}
