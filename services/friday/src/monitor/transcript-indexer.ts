import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import {
  readJsonlDateRange,
  upsertTranscriptIndex,
  getIndexedMtime,
  metaSetNumber,
} from "@friday/shared";
import { listAgents } from "../sessions/registry.js";
import { log } from "../log.js";

const RECONCILE_META_KEY = "transcripts.last_reconciled_at";
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Build the set of session IDs that the registry currently considers active.
 * The indexer skips these — their JSONL files may be growing as the SDK
 * streams turns into them, so caching first/last timestamps would race.
 */
function liveSessionIds(): Set<string> {
  const live = new Set<string>();
  for (const { entry } of listAgents()) {
    if (entry.sessionId) live.add(entry.sessionId);
    // Also exclude formers that the registry still tracks — they've already
    // been indexed once when fresh. Re-indexing them would still be safe,
    // but skipping saves I/O. Active concerns are the current sessionId only.
  }
  return live;
}

/**
 * Walk every `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, indexing
 * any session whose mtime has changed since the last pass and which isn't
 * currently being written to by an active agent.
 */
export function indexTranscripts(): { indexed: number; skipped: number; errors: number } {
  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(PROJECTS_DIR);
  } catch {
    return { indexed, skipped, errors };
  }

  const live = liveSessionIds();
  const indexedAt = new Date().toISOString();

  for (const encodedCwd of projectDirs) {
    const dir = join(PROJECTS_DIR, encodedCwd);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const sessionId = basename(file, ".jsonl");
      if (live.has(sessionId)) {
        skipped++;
        continue;
      }

      const filePath = join(dir, file);
      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        errors++;
        continue;
      }
      const mtimeMs = Math.floor(stat.mtimeMs);

      const previous = getIndexedMtime(sessionId, encodedCwd);
      if (previous != null && previous >= mtimeMs) {
        skipped++;
        continue;
      }

      const range = readJsonlDateRange(filePath);
      if (!range) {
        errors++;
        continue;
      }

      upsertTranscriptIndex({
        sessionId,
        encodedCwd,
        filePath,
        firstTimestamp: range.firstAt,
        lastTimestamp: range.lastAt,
        turnCount: null,
        fileSizeBytes: stat.size,
        fileMtime: mtimeMs,
        indexedAt,
      });
      indexed++;
    }
  }

  metaSetNumber(RECONCILE_META_KEY, Date.now());
  return { indexed, skipped, errors };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Runs `indexTranscripts()` once immediately, then on a slow interval.
 * Default cadence is 5 minutes — files only change during active turns,
 * and active sessions are skipped anyway, so a tight loop would be wasted.
 */
export function startTranscriptIndexer(intervalMs = 5 * 60_000): void {
  const initial = indexTranscripts();
  log("info", "transcripts_indexed", initial);

  timer = setInterval(() => {
    try {
      const result = indexTranscripts();
      if (result.indexed > 0 || result.errors > 0) {
        log("info", "transcripts_indexed", result);
      }
    } catch (err) {
      log("error", "transcripts_index_failed", { error: String(err) });
    }
  }, intervalMs);
  // Don't keep the event loop alive solely for the indexer.
  timer.unref?.();
}

export function stopTranscriptIndexer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
