import { eq, sql } from "drizzle-orm";
import { getDb, getRawDb } from "./client.js";
import { memories, type MemoryRow } from "./schema.js";

export interface DbMemoryRow {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  fileMtime: number | null;
  recallCount: number;
  lastRecalledAt: string | null;
}

function rowToDb(r: MemoryRow): DbMemoryRow {
  let tags: string[] = [];
  try {
    tags = JSON.parse(r.tags) as string[];
  } catch {
    tags = [];
  }
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    tags,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    fileMtime: r.fileMtime,
    recallCount: r.recallCount,
    lastRecalledAt: r.lastRecalledAt,
  };
}

export function getMemoryById(id: string): DbMemoryRow | null {
  const row = getDb().select().from(memories).where(eq(memories.id, id)).get();
  return row ? rowToDb(row) : null;
}

export function listMemoriesAll(): DbMemoryRow[] {
  return getDb().select().from(memories).all().map(rowToDb);
}

export interface UpsertMemoryInput {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  fileMtime?: number | null;
  /** Seed value, applied only on INSERT — preserved if the row already exists. */
  initialRecallCount?: number;
  /** Seed value, applied only on INSERT — preserved if the row already exists. */
  initialLastRecalledAt?: string | null;
}

/** Upsert a memory. Preserves recallCount and lastRecalledAt across calls. */
export function upsertMemory(input: UpsertMemoryInput): void {
  const tagsJson = JSON.stringify(input.tags);
  getDb()
    .insert(memories)
    .values({
      id: input.id,
      title: input.title,
      content: input.content,
      tags: tagsJson,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      fileMtime: input.fileMtime ?? null,
      recallCount: input.initialRecallCount ?? 0,
      lastRecalledAt: input.initialLastRecalledAt ?? null,
    })
    .onConflictDoUpdate({
      target: memories.id,
      set: {
        title: input.title,
        content: input.content,
        tags: tagsJson,
        createdBy: input.createdBy,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        fileMtime: input.fileMtime ?? null,
      },
    })
    .run();
}

export function deleteMemory(id: string): boolean {
  const result = getDb().delete(memories).where(eq(memories.id, id)).run();
  return result.changes > 0;
}

export function incrementRecall(id: string): DbMemoryRow | null {
  const now = new Date().toISOString();
  getDb()
    .update(memories)
    .set({
      recallCount: sql`${memories.recallCount} + 1`,
      lastRecalledAt: now,
    })
    .where(eq(memories.id, id))
    .run();
  return getMemoryById(id);
}

interface FtsRawRow {
  id: string;
  title: string;
  content: string;
  tags: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  file_mtime: number | null;
  recall_count: number;
  last_recalled_at: string | null;
}

/**
 * Full-text search via FTS5. Returns memory rows ordered by FTS5 rank
 * (best match first). `query` is an FTS5 MATCH expression — callers should
 * sanitize user input via `escapeFtsQuery()`.
 */
export function searchMemoriesFts(query: string, limit = 20): DbMemoryRow[] {
  const raw = getRawDb();
  const rows = raw
    .prepare(
      `SELECT m.* FROM memories m
       JOIN memories_fts ON memories_fts.rowid = m.rowid
       WHERE memories_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as FtsRawRow[];
  // Raw better-sqlite3 returns the underlying column names (snake_case);
  // re-map to the camelCased Drizzle row shape before delegating to rowToDb.
  return rows.map((r) =>
    rowToDb({
      id: r.id,
      title: r.title,
      content: r.content,
      tags: r.tags,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      fileMtime: r.file_mtime,
      recallCount: r.recall_count,
      lastRecalledAt: r.last_recalled_at,
    } as MemoryRow),
  );
}

/**
 * Escape user input for FTS5 MATCH. Each token is quoted (literal) and
 * suffixed with `*` for prefix matching, so `deploy` finds "deployment".
 * Tokens are joined with `OR` to mirror the previous JS scoring's
 * keyword-OR semantics — JS scoring narrows the candidate set afterwards.
 *
 * Returns an empty string if no usable tokens remain.
 */
export function escapeFtsQuery(input: string): string {
  const tokens = input
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, "").trim())
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

export function existingMemoryIds(): Set<string> {
  const rows = getRawDb().prepare("SELECT id FROM memories").all() as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

export { memories } from "./schema.js";
