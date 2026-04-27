import {
  searchMemoriesFts,
  escapeFtsQuery,
  incrementRecall,
  type DbMemoryRow,
} from "@friday/shared";
import { listEntries, touchRecall, type MemoryEntry } from "./store.js";

export interface SearchOptions {
  /** Free-text query — matched against title, content, and tags */
  query: string;
  /** Filter to entries with ALL of these tags */
  tags?: string[];
  /** Maximum results to return (default: 10) */
  limit?: number;
  /** If true, increment recall count on returned entries */
  trackRecall?: boolean;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  /** Which fields matched */
  matchedOn: string[];
}

function rowToEntry(r: DbMemoryRow): MemoryEntry {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    tags: r.tags,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    recallCount: r.recallCount,
    lastRecalledAt: r.lastRecalledAt,
  };
}

/**
 * Search memories. Uses FTS5 to narrow the candidate set when a query is
 * provided, then applies the same hybrid scoring as before:
 *
 * - Title keyword match: 3 points per keyword
 * - Content keyword match: 1 point per keyword
 * - Tag exact match: 5 points per tag
 * - Recall frequency boost: log2(recallCount + 1) bonus
 *
 * Tag filters are applied as a post-step (FTS5 tokenization can't enforce
 * "contains all of these tags" by itself).
 */
export function searchMemories(options: SearchOptions): SearchResult[] {
  const { query, tags, limit = 10, trackRecall = true } = options;

  const ftsQuery = query.trim() ? escapeFtsQuery(query) : "";

  // Pull candidates: FTS5 match (broad — extra rows let scoring re-rank
  // accurately within the limit) or full list when no query.
  let candidates: MemoryEntry[];
  if (ftsQuery) {
    candidates = searchMemoriesFts(ftsQuery, Math.max(50, limit * 5)).map(rowToEntry);
    // FTS5 with a query but no matches may also indicate a tokenization
    // edge case (e.g. punctuation-only query, or substring-mid-token
    // matches FTS5 can't express). Fall back to a full scan so JS scoring
    // can attempt a substring match — small N, cheap.
    if (candidates.length === 0) candidates = listEntries();
  } else {
    candidates = listEntries();
  }

  // Tag filter — must contain ALL specified tags.
  if (tags && tags.length > 0) {
    const requiredTags = new Set(tags.map((t) => t.toLowerCase()));
    candidates = candidates.filter((e) => {
      const entryTags = new Set(e.tags.map((t) => t.toLowerCase()));
      for (const rt of requiredTags) {
        if (!entryTags.has(rt)) return false;
      }
      return true;
    });
  }

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 1);

  const results: SearchResult[] = [];

  for (const entry of candidates) {
    let score = 0;
    const matchedOn: string[] = [];

    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();
    const entryTagsLower = entry.tags.map((t) => t.toLowerCase());

    for (const kw of keywords) {
      if (titleLower.includes(kw)) {
        score += 3;
        if (!matchedOn.includes("title")) matchedOn.push("title");
      }

      if (contentLower.includes(kw)) {
        score += 1;
        if (!matchedOn.includes("content")) matchedOn.push("content");
      }

      if (entryTagsLower.includes(kw)) {
        score += 5;
        if (!matchedOn.includes("tags")) matchedOn.push("tags");
      }
    }

    if (keywords.length === 0) {
      score = 1;
    }

    if (score === 0) continue;

    score += Math.log2(entry.recallCount + 1);

    results.push({ entry, score, matchedOn });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
  });

  const limited = results.slice(0, limit);

  if (trackRecall) {
    for (const result of limited) {
      const updated = incrementRecall(result.entry.id);
      if (updated) {
        result.entry = rowToEntry(updated);
      } else {
        // DB row missing — fall through to .md-aware path so callers still
        // see incremented counts on legacy entries.
        const fallback = touchRecall(result.entry.id);
        if (fallback) result.entry = fallback;
      }
    }
  }

  return limited;
}
