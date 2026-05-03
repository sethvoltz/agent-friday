import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// ── Usage log ───────────────────────────────────────────────────
// Replaces ~/.friday/usage.jsonl. Append-only by the daemon, read-heavy
// from the dashboard. Aggregations only — no row-level reads.
export const usage = sqliteTable(
  "usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    timestamp: text("timestamp").notNull(),                          // ISO 8601
    channelId: text("channel_id").notNull().default(""),
    sessionType: text("session_type").notNull(),                     // 'orchestrator'|'builder'|'helper'|'scheduled'|'bare'
    sessionId: text("session_id").notNull(),
    agentName: text("agent_name"),                                   // denormalized; NULL for bare sessions
    model: text("model"),
    costUsd: real("cost_usd"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    turnNumber: integer("turn_number"),                              // NULL when not applicable
    durationMs: integer("duration_ms"),                              // NULL when not measured
  },
  (t) => ({
    sessionTimestampIdx: index("usage_session_timestamp").on(t.sessionId, t.timestamp),
    channelTypeIdx: index("usage_channel_type").on(t.channelId, t.sessionType, t.timestamp),
    agentTimestampIdx: index("usage_agent_timestamp").on(t.agentName, t.timestamp),
    timestampIdx: index("usage_timestamp").on(t.timestamp),
  }),
);

// ── Memory entries (derived index over ~/.friday/memory/entries/*.md) ──
// `.md` files are the source of truth for user-facing fields. The DB mirrors
// searchable fields for FTS5 and owns operational-only fields (recallCount,
// lastRecalledAt) that don't belong in `.md` frontmatter.
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),                                       // mirror of .md filename
  title: text("title").notNull(),                                    // mirror
  content: text("content").notNull(),                                // mirror (drives FTS5)
  tags: text("tags").notNull().default("[]"),                        // mirror; JSON array as text
  createdBy: text("created_by").notNull(),                           // mirror
  createdAt: text("created_at").notNull(),                           // mirror
  updatedAt: text("updated_at").notNull(),                           // mirror
  fileMtime: integer("file_mtime"),                                  // staleness check (unix ms)
  recallCount: integer("recall_count").notNull().default(0),         // DB-only
  lastRecalledAt: text("last_recalled_at"),                          // DB-only
});

// ── Transcript index (derived index over ~/.claude/projects/**/*.jsonl) ──
// SDK-owned files; we cache timestamps + turn counts so the dashboard can
// avoid per-session partial reads.
export const transcriptIndex = sqliteTable(
  "transcript_index",
  {
    sessionId: text("session_id").notNull(),
    encodedCwd: text("encoded_cwd").notNull(),
    filePath: text("file_path").notNull(),
    firstTimestamp: text("first_timestamp"),
    lastTimestamp: text("last_timestamp"),
    turnCount: integer("turn_count"),
    fileSizeBytes: integer("file_size_bytes"),
    fileMtime: integer("file_mtime"),                                // unix ms
    indexedAt: text("indexed_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.encodedCwd] }),
  }),
);

// ── Generic key/value store ─────────────────────────────────────
// For things like `memories.last_reconciled_at`, `transcripts.last_reconciled_at`.
export const dbMeta = sqliteTable("db_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ── Thread connections ───────────────────────────────────────────────────────
// Bidirectional link between a Slack thread and a running agent.
// Enforces 0-or-1: agent_name PK means one thread per agent; thread_ts UNIQUE
// means one agent per thread. last_activity_at drives idle-timeout recovery.
export const threadConnections = sqliteTable("thread_connections", {
  agentName:      text("agent_name").primaryKey(),
  channelId:      text("channel_id").notNull(),
  threadTs:       text("thread_ts").notNull().unique(),
  lastActivityAt: integer("last_activity_at").notNull(), // Unix ms
  createdAt:      integer("created_at").notNull(),       // Unix ms
});

export type UsageRow = typeof usage.$inferSelect;
export type UsageInsert = typeof usage.$inferInsert;
export type MemoryRow = typeof memories.$inferSelect;
export type MemoryInsert = typeof memories.$inferInsert;
export type TranscriptIndexRow = typeof transcriptIndex.$inferSelect;
export type TranscriptIndexInsert = typeof transcriptIndex.$inferInsert;
export type ThreadConnectionRow = typeof threadConnections.$inferSelect;
export type ThreadConnectionInsert = typeof threadConnections.$inferInsert;
