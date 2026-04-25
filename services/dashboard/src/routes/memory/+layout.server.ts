import { listEntries } from "@friday/memory";
import type { MemoryEntry } from "@friday/memory";

export interface MemorySidebarData {
  memories: MemoryEntry[];
  allTags: string[];
}

export function load(): MemorySidebarData {
  let memories: MemoryEntry[] = [];
  try {
    memories = listEntries();
  } catch {
    // Memory dir may not exist yet
  }

  // Sort by updatedAt descending (most recent first)
  memories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Collect unique tags for the filter dropdown
  const allTags = [...new Set(memories.flatMap((m) => m.tags))].sort();

  return { memories, allTags };
}
