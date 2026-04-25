import { getEntry } from "@friday/memory";
import { error } from "@sveltejs/kit";
import type { MemoryEntry } from "@friday/memory";

export function load({ params }: { params: { id: string } }): { entry: MemoryEntry } {
  const entry = getEntry(params.id);
  if (!entry) throw error(404, "Memory not found");
  return { entry };
}
