import { searchMemories } from "@friday/memory";

export interface AutoRecallOptions {
  /** Max entries to inject (default: 5) */
  limit?: number;
  /** Minimum score threshold (default: 2) */
  minScore?: number;
}

/**
 * Search memories relevant to the incoming prompt and format them
 * as a context block to prepend.
 * Returns null if no relevant memories found.
 */
export function buildMemoryContext(
  promptText: string,
  options?: AutoRecallOptions
): string | null {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 2;

  const results = searchMemories({
    query: promptText,
    limit,
    trackRecall: true,
  });

  const relevant = results.filter((r) => r.score >= minScore);
  if (relevant.length === 0) return null;

  const entries = relevant.map((r) => {
    const tags =
      r.entry.tags.length > 0 ? ` [${r.entry.tags.join(", ")}]` : "";
    return `- **${r.entry.title}**${tags}: ${r.entry.content}`;
  });

  return [
    "<memory-context>",
    "Relevant memories (auto-recalled):",
    "",
    ...entries,
    "</memory-context>",
  ].join("\n");
}
