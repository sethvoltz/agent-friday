import { sql, eq, and, desc, gte, isNotNull } from "drizzle-orm";
import { getDb, getRawDb } from "./client.js";
import { usage, type UsageInsert } from "./schema.js";
import type { SessionType } from "../agents.js";

// ── Inserts ─────────────────────────────────────────────────────

export interface InsertUsageInput {
  timestamp: string;
  channelId: string;
  sessionType: SessionType;
  sessionId: string;
  agentName?: string | null;
  model?: string | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnNumber?: number | null;
  durationMs?: number | null;
}

export function insertUsage(entry: InsertUsageInput): void {
  const row: UsageInsert = {
    timestamp: entry.timestamp,
    channelId: entry.channelId,
    sessionType: entry.sessionType,
    sessionId: entry.sessionId,
    agentName: entry.agentName ?? null,
    model: entry.model ?? null,
    costUsd: entry.costUsd,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    cacheReadTokens: entry.cacheReadTokens,
    turnNumber: entry.turnNumber ?? null,
    durationMs: entry.durationMs ?? null,
  };
  getDb().insert(usage).values(row).run();
}

/** Bulk insert in a single transaction. Used by the one-shot JSONL → DB import. */
export function bulkInsertUsage(rows: InsertUsageInput[]): number {
  if (rows.length === 0) return 0;
  const raw = getRawDb();
  const stmt = raw.prepare(`
    INSERT INTO usage (
      timestamp, channel_id, session_type, session_id, agent_name, model,
      cost_usd, input_tokens, output_tokens,
      cache_creation_tokens, cache_read_tokens, turn_number, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = raw.transaction((batch: InsertUsageInput[]) => {
    let n = 0;
    for (const e of batch) {
      stmt.run(
        e.timestamp,
        e.channelId ?? "",
        e.sessionType,
        e.sessionId,
        e.agentName ?? null,
        e.model ?? null,
        e.costUsd,
        e.inputTokens,
        e.outputTokens,
        e.cacheCreationTokens,
        e.cacheReadTokens,
        e.turnNumber ?? null,
        e.durationMs ?? null,
      );
      n++;
    }
    return n;
  });
  return tx(rows);
}

export function isUsageEmpty(): boolean {
  const row = getRawDb().prepare("SELECT 1 FROM usage LIMIT 1").get();
  return row === undefined;
}

// ── Aggregations ────────────────────────────────────────────────

export interface SessionStats {
  sessionId: string;
  turnCount: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  cacheHitRate: number; // 0-100
  firstTurnAt: string;
  lastTurnAt: string;
  totalDurationMs: number;
}

export function getSessionStats(sessionId: string): SessionStats | null {
  const row = getRawDb()
    .prepare(
      `SELECT
         COUNT(*)                          AS turn_count,
         COALESCE(SUM(cost_usd),0)         AS total_cost,
         COALESCE(SUM(input_tokens),0)     AS total_input,
         COALESCE(SUM(output_tokens),0)    AS total_output,
         COALESCE(SUM(cache_creation_tokens),0) AS total_cache_create,
         COALESCE(SUM(cache_read_tokens),0)     AS total_cache_read,
         COALESCE(SUM(duration_ms),0)      AS total_duration,
         MIN(timestamp)                    AS first_at,
         MAX(timestamp)                    AS last_at
       FROM usage WHERE session_id = ?`,
    )
    .get(sessionId) as
    | {
        turn_count: number;
        total_cost: number;
        total_input: number;
        total_output: number;
        total_cache_create: number;
        total_cache_read: number;
        total_duration: number;
        first_at: string | null;
        last_at: string | null;
      }
    | undefined;

  if (!row || row.turn_count === 0) return null;

  const totalCacheTokens = row.total_cache_create + row.total_cache_read;
  const cacheHitRate =
    totalCacheTokens > 0 ? Math.round((row.total_cache_read / totalCacheTokens) * 100) : 0;

  return {
    sessionId,
    turnCount: row.turn_count,
    totalCostUsd: row.total_cost,
    totalInputTokens: row.total_input,
    totalOutputTokens: row.total_output,
    totalCacheCreationTokens: row.total_cache_create,
    totalCacheReadTokens: row.total_cache_read,
    cacheHitRate,
    firstTurnAt: row.first_at ?? "",
    lastTurnAt: row.last_at ?? "",
    totalDurationMs: row.total_duration,
  };
}

export interface SessionAggRow {
  sessionId: string;
  firstAt: string;
  lastAt: string;
  turns: number;
}

/** Returns a map sessionId → { firstAt, lastAt, turns } across all usage rows. */
export function getAllSessionAggregates(): Map<string, { firstAt: string; lastAt: string; turns: number }> {
  const rows = getRawDb()
    .prepare(
      `SELECT session_id AS sessionId,
              MIN(timestamp) AS firstAt,
              MAX(timestamp) AS lastAt,
              COUNT(*)       AS turns
       FROM usage
       GROUP BY session_id`,
    )
    .all() as SessionAggRow[];
  const map = new Map<string, { firstAt: string; lastAt: string; turns: number }>();
  for (const r of rows) map.set(r.sessionId, { firstAt: r.firstAt, lastAt: r.lastAt, turns: r.turns });
  return map;
}

export interface BareSessionRow {
  channelId: string;
  sessionId: string;
  firstAt: string;
  lastAt: string;
  turns: number;
}

export function getBareSessionAggregates(): BareSessionRow[] {
  return getRawDb()
    .prepare(
      `SELECT channel_id   AS channelId,
              session_id   AS sessionId,
              MIN(timestamp) AS firstAt,
              MAX(timestamp) AS lastAt,
              COUNT(*)     AS turns
       FROM usage
       WHERE session_type = 'bare'
       GROUP BY channel_id, session_id
       ORDER BY lastAt DESC`,
    )
    .all() as BareSessionRow[];
}

/** Total cost summed by agent_name. NULL agent_name (bare sessions) are excluded. */
export function getCostByAgent(): Record<string, number> {
  const rows = getRawDb()
    .prepare(
      `SELECT agent_name AS name, COALESCE(SUM(cost_usd),0) AS cost
       FROM usage
       WHERE agent_name IS NOT NULL
       GROUP BY agent_name`,
    )
    .all() as Array<{ name: string; cost: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.name] = r.cost;
  return out;
}

export interface ActivityRow {
  timestamp: string;
  costUsd: number | null;
}

/** Stream rows for the activity grid (last N days). Day-bucketing happens in JS to preserve local-tz behavior. */
export function getActivityRows(sinceIsoMs: number): ActivityRow[] {
  const since = new Date(sinceIsoMs).toISOString();
  return getRawDb()
    .prepare(
      `SELECT timestamp, cost_usd AS costUsd
       FROM usage
       WHERE timestamp >= ?
       ORDER BY timestamp`,
    )
    .all(since) as ActivityRow[];
}

/** Find the most recent sessionId for a channel + sessionType. Returns null if none. */
export function findMostRecentSession(
  channelId: string,
  sessionType: SessionType,
): { sessionId: string; lastAt: string } | null {
  const row = getRawDb()
    .prepare(
      `SELECT session_id AS sessionId, MAX(timestamp) AS lastAt
       FROM usage
       WHERE channel_id = ? AND session_type = ?
       GROUP BY session_id
       ORDER BY lastAt DESC
       LIMIT 1`,
    )
    .get(channelId, sessionType) as { sessionId: string; lastAt: string } | undefined;
  return row ?? null;
}

/** Per-session stats for an arbitrary set of session IDs. */
export function getSessionAggregates(sessionIds: string[]): Map<string, { firstAt: string; lastAt: string; turns: number }> {
  if (sessionIds.length === 0) return new Map();
  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = getRawDb()
    .prepare(
      `SELECT session_id AS sessionId,
              MIN(timestamp) AS firstAt,
              MAX(timestamp) AS lastAt,
              COUNT(*)       AS turns
       FROM usage
       WHERE session_id IN (${placeholders})
       GROUP BY session_id`,
    )
    .all(...sessionIds) as SessionAggRow[];
  const map = new Map<string, { firstAt: string; lastAt: string; turns: number }>();
  for (const r of rows) map.set(r.sessionId, { firstAt: r.firstAt, lastAt: r.lastAt, turns: r.turns });
  return map;
}

/**
 * Return every usage row in the legacy `UsageEntry` shape. Used by the
 * dashboard's home/sessions pages, which historically read the whole
 * `usage.jsonl` into memory; swapping the source to SQL removes the
 * full-file scan but keeps the in-memory shape so downstream UI code is
 * untouched.
 */
export interface UsageEntryRow {
  timestamp: string;
  channelId: string;
  sessionType: SessionType;
  sessionId: string;
  agentName: string | null;
  model: string | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnNumber: number | null;
  durationMs: number | null;
}

export function getAllUsageEntries(): UsageEntryRow[] {
  // turn_number / duration_ms are NULL-able in the schema but the legacy
  // dashboard code sums them as plain numbers. Coalesce here so callers
  // never see NULL for these two fields.
  return getRawDb()
    .prepare(
      `SELECT timestamp,
              channel_id              AS channelId,
              session_type            AS sessionType,
              session_id              AS sessionId,
              agent_name              AS agentName,
              model,
              cost_usd                AS costUsd,
              input_tokens            AS inputTokens,
              output_tokens           AS outputTokens,
              cache_creation_tokens   AS cacheCreationTokens,
              cache_read_tokens       AS cacheReadTokens,
              COALESCE(turn_number, 0) AS turnNumber,
              COALESCE(duration_ms, 0) AS durationMs
       FROM usage
       ORDER BY timestamp`,
    )
    .all() as UsageEntryRow[];
}

/** Re-export the `usage` Drizzle table for callers that need raw query builder access. */
export { usage } from "./schema.js";
