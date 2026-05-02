import { eq, and, inArray } from "drizzle-orm";
import { getDb, getRawDb } from "./client.js";
import { transcriptIndex, type TranscriptIndexInsert, type TranscriptIndexRow } from "./schema.js";

export interface TranscriptIndexEntry {
  sessionId: string;
  encodedCwd: string;
  filePath: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  turnCount: number | null;
  fileSizeBytes: number | null;
  fileMtime: number | null;
  indexedAt: string;
}

export function upsertTranscriptIndex(entry: TranscriptIndexEntry): void {
  const row: TranscriptIndexInsert = {
    sessionId: entry.sessionId,
    encodedCwd: entry.encodedCwd,
    filePath: entry.filePath,
    firstTimestamp: entry.firstTimestamp,
    lastTimestamp: entry.lastTimestamp,
    turnCount: entry.turnCount,
    fileSizeBytes: entry.fileSizeBytes,
    fileMtime: entry.fileMtime,
    indexedAt: entry.indexedAt,
  };
  getDb()
    .insert(transcriptIndex)
    .values(row)
    .onConflictDoUpdate({
      target: [transcriptIndex.sessionId, transcriptIndex.encodedCwd],
      set: {
        filePath: row.filePath,
        firstTimestamp: row.firstTimestamp,
        lastTimestamp: row.lastTimestamp,
        turnCount: row.turnCount,
        fileSizeBytes: row.fileSizeBytes,
        fileMtime: row.fileMtime,
        indexedAt: row.indexedAt,
      },
    })
    .run();
}

/**
 * Look up indexed timestamps by session ID. Encoded cwd is ignored at lookup
 * time because callers have only the session ID; this returns the first
 * matching row when multiple exist (rare — the same sessionId across cwds).
 */
export function getIndexedRange(sessionId: string): {
  firstAt: string | null;
  lastAt: string | null;
} | null {
  const row = getDb()
    .select()
    .from(transcriptIndex)
    .where(eq(transcriptIndex.sessionId, sessionId))
    .get();
  if (!row) return null;
  return { firstAt: row.firstTimestamp, lastAt: row.lastTimestamp };
}

export function getIndexedRanges(sessionIds: string[]): Map<string, { firstAt: string; lastAt: string }> {
  const map = new Map<string, { firstAt: string; lastAt: string }>();
  if (sessionIds.length === 0) return map;
  const rows = getDb()
    .select()
    .from(transcriptIndex)
    .where(inArray(transcriptIndex.sessionId, sessionIds))
    .all();
  for (const r of rows) {
    if (!r.firstTimestamp || !r.lastTimestamp) continue;
    const existing = map.get(r.sessionId);
    if (!existing || r.lastTimestamp > existing.lastAt) {
      map.set(r.sessionId, { firstAt: r.firstTimestamp, lastAt: r.lastTimestamp });
    }
  }
  return map;
}

export function getIndexedMtime(sessionId: string, encodedCwd: string): number | null {
  const row = getDb()
    .select()
    .from(transcriptIndex)
    .where(
      and(
        eq(transcriptIndex.sessionId, sessionId),
        eq(transcriptIndex.encodedCwd, encodedCwd),
      ),
    )
    .get();
  return row?.fileMtime ?? null;
}

export function deleteTranscriptIndexByPath(filePath: string): void {
  getDb().delete(transcriptIndex).where(eq(transcriptIndex.filePath, filePath)).run();
}

export type { TranscriptIndexRow };
