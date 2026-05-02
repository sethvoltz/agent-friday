import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, basename } from "node:path";
import {
  FRIDAY_DIR,
  upsertMemory,
  deleteMemory,
  getMemoryById,
  listMemoriesAll,
  incrementRecall,
  existingMemoryIds,
  metaGetNumber,
  metaSetNumber,
  type DbMemoryRow,
} from "@friday/shared";

/** Root directory for memory storage */
export const MEMORY_DIR = join(FRIDAY_DIR, "memory");
const ENTRIES_DIR = join(MEMORY_DIR, "entries");
const RECONCILE_META_KEY = "memories.last_reconciled_at";
/** Overlap window (ms) on each reconcile pass — guards against fs clock skew
 *  and files written during the prior pass. Upserts are idempotent. */
const RECONCILE_OVERLAP_MS = 60_000;

export interface MemoryEntry {
  /** Unique ID derived from filename (without extension) */
  id: string;
  /** Short title */
  title: string;
  /** Memory content (the body text) */
  content: string;
  /** Tags for categorization and search */
  tags: string[];
  /** Who created this memory */
  createdBy: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Number of times this memory has been recalled */
  recallCount: number;
  /** ISO timestamp of last recall */
  lastRecalledAt: string | null;
}

export function ensureMemoryDirs(): void {
  mkdirSync(ENTRIES_DIR, { recursive: true });
}

export function generateId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = Date.now().toString(36).slice(-4);
  return `${slug}-${suffix}`;
}

/**
 * Parse a memory markdown file into a MemoryEntry.
 * Format:
 * ---
 * title: ...
 * tags: [...]
 * createdBy: ...
 * createdAt: ...
 * updatedAt: ...
 * ---
 * Body content here
 *
 * Note: legacy entries may also include `recallCount` and `lastRecalledAt`
 * in their frontmatter. Those values are read for backwards compatibility
 * (used as seed when the DB row is first created) but are no longer written.
 */
export function parseEntry(id: string, raw: string): MemoryEntry {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`Invalid memory entry format: ${id}`);
  }

  const frontmatter = fmMatch[1];
  const content = fmMatch[2].trim();

  const fields = parseFrontmatter(frontmatter);

  return {
    id,
    title: fields.title ?? id,
    content,
    tags: fields.tags ?? [],
    createdBy: fields.createdBy ?? "unknown",
    createdAt: fields.createdAt ?? new Date().toISOString(),
    updatedAt: fields.updatedAt ?? new Date().toISOString(),
    recallCount: fields.recallCount ?? 0,
    lastRecalledAt: fields.lastRecalledAt ?? null,
  };
}

/**
 * Serialize a MemoryEntry to markdown with YAML frontmatter.
 * Operational fields (`recallCount`, `lastRecalledAt`) are intentionally
 * excluded — they live in the DB only, so editing them doesn't churn `.md`
 * files on every recall.
 */
export function serializeEntry(entry: MemoryEntry): string {
  const tagsLine =
    entry.tags.length > 0 ? `[${entry.tags.map((t) => `"${t}"`).join(", ")}]` : "[]";

  const lines = [
    "---",
    `title: ${JSON.stringify(entry.title)}`,
    `tags: ${tagsLine}`,
    `createdBy: "${entry.createdBy}"`,
    `createdAt: "${entry.createdAt}"`,
    `updatedAt: "${entry.updatedAt}"`,
    "---",
    "",
    entry.content,
    "",
  ];

  return lines.join("\n");
}

function entryFromDbRow(row: DbMemoryRow): MemoryEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    recallCount: row.recallCount,
    lastRecalledAt: row.lastRecalledAt,
  };
}

function fileMtimeMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Reconcile DB rows against `~/.friday/memory/entries/*.md`. Upserts changed
 * files (mtime ≥ last_reconciled - overlap) and deletes DB rows whose `.md`
 * is gone. Idempotent — safe to call repeatedly.
 *
 * The overlap window catches files written during the prior pass even if the
 * fs clock drifts slightly.
 */
export function reconcileMemories(): { upserted: number; deleted: number } {
  ensureMemoryDirs();

  const last = metaGetNumber(RECONCILE_META_KEY) ?? 0;
  const cutoff = Math.max(0, last - RECONCILE_OVERLAP_MS);
  const now = Date.now();

  let upserted = 0;
  const seenIds = new Set<string>();

  const files = readdirSync(ENTRIES_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const id = basename(file, ".md");
    seenIds.add(id);
    const filePath = join(ENTRIES_DIR, file);
    const mtime = fileMtimeMs(filePath);
    if (mtime == null) continue;
    if (mtime < cutoff) continue;

    let parsed: MemoryEntry;
    try {
      parsed = parseEntry(id, readFileSync(filePath, "utf-8"));
    } catch {
      continue;
    }
    upsertMemory({
      id,
      title: parsed.title,
      content: parsed.content,
      tags: parsed.tags,
      createdBy: parsed.createdBy,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      fileMtime: Math.floor(mtime),
      initialRecallCount: parsed.recallCount,
      initialLastRecalledAt: parsed.lastRecalledAt,
    });
    upserted++;
  }

  let deleted = 0;
  for (const id of existingMemoryIds()) {
    if (!seenIds.has(id)) {
      if (deleteMemory(id)) deleted++;
    }
  }

  metaSetNumber(RECONCILE_META_KEY, now);
  return { upserted, deleted };
}

function ensureReconciled(): void {
  if (metaGetNumber(RECONCILE_META_KEY) != null) return;
  reconcileMemories();
}

/**
 * Save a new memory entry. Writes the `.md` file and upserts the DB row.
 */
export function saveEntry(opts: {
  title: string;
  content: string;
  tags?: string[];
  createdBy: string;
}): MemoryEntry {
  ensureMemoryDirs();

  const id = generateId(opts.title);
  const now = new Date().toISOString();

  const entry: MemoryEntry = {
    id,
    title: opts.title,
    content: opts.content,
    tags: opts.tags ?? [],
    createdBy: opts.createdBy,
    createdAt: now,
    updatedAt: now,
    recallCount: 0,
    lastRecalledAt: null,
  };

  const filePath = join(ENTRIES_DIR, `${id}.md`);
  writeFileSync(filePath, serializeEntry(entry));
  const mtime = fileMtimeMs(filePath);
  upsertMemory({
    id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    fileMtime: mtime != null ? Math.floor(mtime) : null,
  });
  return entry;
}

/**
 * Get a memory entry by ID. Reads from the DB; falls back to the `.md` file
 * if the DB doesn't yet have it (e.g. an entry added externally before
 * reconcile ran).
 */
export function getEntry(id: string): MemoryEntry | null {
  ensureReconciled();
  const dbRow = getMemoryById(id);
  if (dbRow) return entryFromDbRow(dbRow);

  const filePath = join(ENTRIES_DIR, `${id}.md`);
  if (!existsSync(filePath)) return null;
  // File exists but DB hasn't seen it — reconcile then re-fetch.
  reconcileMemories();
  const refreshed = getMemoryById(id);
  return refreshed ? entryFromDbRow(refreshed) : null;
}

/**
 * Increment the recall count for an entry. DB-only — does not touch the
 * `.md` file.
 */
export function touchRecall(id: string): MemoryEntry | null {
  const updated = incrementRecall(id);
  return updated ? entryFromDbRow(updated) : null;
}

/**
 * Update a memory entry's content and/or metadata. Writes both the `.md`
 * file and the DB row.
 */
export function updateEntry(
  id: string,
  updates: Partial<Pick<MemoryEntry, "title" | "content" | "tags">>,
): MemoryEntry | null {
  const existing = getEntry(id);
  if (!existing) return null;

  const next: MemoryEntry = {
    ...existing,
    title: updates.title ?? existing.title,
    content: updates.content ?? existing.content,
    tags: updates.tags ?? existing.tags,
    updatedAt: new Date().toISOString(),
  };

  const filePath = join(ENTRIES_DIR, `${id}.md`);
  writeFileSync(filePath, serializeEntry(next));
  const mtime = fileMtimeMs(filePath);
  upsertMemory({
    id,
    title: next.title,
    content: next.content,
    tags: next.tags,
    createdBy: next.createdBy,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
    fileMtime: mtime != null ? Math.floor(mtime) : null,
  });
  return next;
}

/**
 * Delete a memory entry. Removes both the `.md` file and the DB row.
 */
export function forgetEntry(id: string): boolean {
  const filePath = join(ENTRIES_DIR, `${id}.md`);
  const fileExisted = existsSync(filePath);
  if (fileExisted) unlinkSync(filePath);
  const dbDeleted = deleteMemory(id);
  return fileExisted || dbDeleted;
}

/**
 * List all memory entries (from the DB).
 */
export function listEntries(): MemoryEntry[] {
  ensureMemoryDirs();
  ensureReconciled();
  return listMemoriesAll().map(entryFromDbRow);
}

// ── Frontmatter parser (minimal YAML subset) ────────────────────

function parseFrontmatter(text: string): Record<string, any> {
  const result: Record<string, any> = {};

  for (const line of text.split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    result[key] = parseValue(rawValue);
  }

  return result;
}

function parseValue(raw: string): any {
  const trimmed = raw.trim();

  if (trimmed === "null" || trimmed === "") return null;

  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => {
      const v = s.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
      }
      return v;
    });
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  return trimmed;
}
