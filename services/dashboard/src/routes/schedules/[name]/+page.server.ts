import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { error } from "@sveltejs/kit";
import type { ScheduledEntry } from "@friday/shared";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, parent }): Promise<{
  name: string;
  entry: ScheduledEntry;
  stateContent: string | null;
  lastRunContent: string | null;
}> => {
  // Registry inherited from the root layout.
  const { agents } = await parent();

  const entry = agents[params.name];
  if (!entry || entry.type !== "scheduled") {
    throw error(404, "Scheduled agent not found");
  }

  // Read state.md and last-run.md from the agent's stateDir
  let stateContent: string | null = null;
  let lastRunContent: string | null = null;

  const statePath = join(entry.stateDir, "state.md");
  const lastRunPath = join(entry.stateDir, "last-run.md");

  if (existsSync(statePath)) {
    try {
      stateContent = readFileSync(statePath, "utf-8");
    } catch { /* skip */ }
  }

  if (existsSync(lastRunPath)) {
    try {
      lastRunContent = readFileSync(lastRunPath, "utf-8");
    } catch { /* skip */ }
  }

  return {
    name: params.name,
    entry,
    stateContent,
    lastRunContent,
  };
};
