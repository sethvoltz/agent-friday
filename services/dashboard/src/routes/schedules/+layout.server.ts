import { readFileSync, existsSync } from "node:fs";
import {
  AGENTS_PATH,
  type AgentRegistry,
  type ScheduledEntry,
} from "@friday/shared";
import type { LayoutServerLoad } from "./$types";

export interface ScheduleListItem {
  name: string;
  entry: ScheduledEntry;
}

export const load: LayoutServerLoad = async () => {
  let agents: AgentRegistry = {};
  if (existsSync(AGENTS_PATH)) {
    try {
      agents = JSON.parse(readFileSync(AGENTS_PATH, "utf-8"));
    } catch { /* skip */ }
  }

  const schedules: ScheduleListItem[] = [];
  for (const [name, entry] of Object.entries(agents)) {
    if (entry.type === "scheduled") {
      schedules.push({ name, entry });
    }
  }

  // Sort: active first, then idle, then destroyed; within each group by name
  const statusOrder: Record<string, number> = { active: 0, idle: 1, destroyed: 2 };
  schedules.sort((a, b) => {
    const sa = statusOrder[a.entry.status] ?? 1;
    const sb = statusOrder[b.entry.status] ?? 1;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  return { schedules };
};
