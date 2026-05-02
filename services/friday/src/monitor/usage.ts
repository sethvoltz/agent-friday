import { createReadStream, existsSync, renameSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import type { UsageEntry } from "@friday/shared";
import { USAGE_LOG_PATH, insertUsage, isUsageEmpty, bulkInsertUsage } from "@friday/shared";
import type { InsertUsageInput } from "@friday/shared";
import { eventBus } from "../events/bus.js";
import { log } from "../log.js";

export function logUsage(entry: UsageEntry, agentName?: string | null): void {
  insertUsage({
    timestamp: entry.timestamp,
    channelId: entry.channelId,
    sessionType: entry.sessionType,
    sessionId: entry.sessionId,
    agentName: agentName ?? null,
    model: entry.model ?? null,
    costUsd: entry.costUsd,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    cacheReadTokens: entry.cacheReadTokens,
    turnNumber: entry.turnNumber,
    durationMs: entry.durationMs,
  });
  eventBus.publish({ type: "usage:logged", entry });
}

/**
 * One-shot import of legacy `usage.jsonl` into the SQLite `usage` table.
 *
 * Runs on daemon boot. If the JSONL file exists and the `usage` table is
 * empty, the file is stream-parsed and bulk-inserted in a single transaction,
 * then renamed to `usage.jsonl.migrated-<YYYY-MM-DD>` so subsequent boots skip
 * re-importing. The rename (rather than delete) preserves the source data per
 * the project's "preserve over delete" rule.
 */
export async function migrateUsageLog(): Promise<void> {
  if (!existsSync(USAGE_LOG_PATH)) return;
  if (!isUsageEmpty()) return;

  const startedAt = Date.now();
  const sizeBytes = statSync(USAGE_LOG_PATH).size;

  const rows: InsertUsageInput[] = [];
  let parseErrors = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(USAGE_LOG_PATH, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const entry = JSON.parse(trimmed) as UsageEntry;
        rows.push({
          timestamp: entry.timestamp,
          channelId: entry.channelId,
          sessionType: entry.sessionType,
          sessionId: entry.sessionId,
          agentName: null,
          model: entry.model ?? null,
          costUsd: entry.costUsd,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cacheCreationTokens: entry.cacheCreationTokens,
          cacheReadTokens: entry.cacheReadTokens,
          turnNumber: entry.turnNumber,
          durationMs: entry.durationMs,
        });
      } catch {
        parseErrors++;
      }
    });
    rl.on("close", resolve);
    rl.on("error", reject);
    stream.on("error", reject);
  });

  const inserted = bulkInsertUsage(rows);

  const today = new Date().toISOString().slice(0, 10);
  const archivePath = `${USAGE_LOG_PATH}.migrated-${today}`;
  renameSync(USAGE_LOG_PATH, archivePath);

  log("info", "usage_log_migrated", {
    rowsInserted: inserted,
    parseErrors,
    sizeBytes,
    elapsedMs: Date.now() - startedAt,
    archivePath,
  });
}
