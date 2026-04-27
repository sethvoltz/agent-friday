import { eq } from "drizzle-orm";
import { getDb } from "./client.js";
import { dbMeta } from "./schema.js";

/** Read a string value from db_meta. Returns null when absent. */
export function metaGet(key: string): string | null {
  const row = getDb().select().from(dbMeta).where(eq(dbMeta.key, key)).get();
  return row?.value ?? null;
}

/** Upsert a string value into db_meta. */
export function metaSet(key: string, value: string): void {
  getDb()
    .insert(dbMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: dbMeta.key, set: { value } })
    .run();
}

export function metaGetNumber(key: string): number | null {
  const v = metaGet(key);
  return v == null ? null : Number(v);
}

export function metaSetNumber(key: string, value: number): void {
  metaSet(key, String(value));
}
