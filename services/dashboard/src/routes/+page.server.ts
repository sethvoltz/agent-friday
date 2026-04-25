import { readFileSync, existsSync } from "node:fs";
import {
  loadConfig,
  CONFIG_PATH,
  USAGE_LOG_PATH,
  SESSIONS_DIR,
  AGENTS_PATH,
  FRIDAY_DIR,
  resolveTranscriptPath,
  type UsageEntry,
  type AgentRegistry,
  type RegistryEntry,
} from "@friday/shared";
import { listEntries, type MemoryEntry } from "@friday/memory";
import { join } from "node:path";
import type { PageServerLoad } from "./$types";

/** Estimate cost from transcript JSONL token counts when usage.jsonl has no data */
function estimateCostFromTranscript(
  entry: RegistryEntry,
  sessionId: string,
  cwdOverride?: string,
): number {
  const lookupEntry = { ...entry, sessionId };
  const jsonlPath = resolveTranscriptPath(lookupEntry, cwdOverride);
  if (!jsonlPath || !existsSync(jsonlPath)) return 0;

  try {
    const content = readFileSync(jsonlPath, "utf-8");
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreation = 0;
    let cacheRead = 0;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        const u = e?.message?.usage;
        if (u) {
          inputTokens += u.input_tokens ?? 0;
          outputTokens += u.output_tokens ?? 0;
          cacheCreation += u.cache_creation_input_tokens ?? 0;
          cacheRead += u.cache_read_input_tokens ?? 0;
        }
      } catch { /* skip */ }
    }

    // Estimate using Sonnet pricing (most common model for builders)
    // Input: $3/MTok, Output: $15/MTok, Cache write: $3.75/MTok, Cache read: $0.30/MTok
    return (
      (inputTokens * 3) / 1_000_000 +
      (outputTokens * 15) / 1_000_000 +
      (cacheCreation * 3.75) / 1_000_000 +
      (cacheRead * 0.3) / 1_000_000
    );
  } catch {
    return 0;
  }
}

export const load: PageServerLoad = async () => {
  const config = loadConfig();

  // Usage entries
  const usageEntries: UsageEntry[] = [];
  if (existsSync(USAGE_LOG_PATH)) {
    const lines = readFileSync(USAGE_LOG_PATH, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    for (const line of lines) {
      try {
        usageEntries.push(JSON.parse(line));
      } catch {
        // skip
      }
    }
  }

  // Agent registry
  let agents: AgentRegistry = {};
  if (existsSync(AGENTS_PATH)) {
    try {
      agents = JSON.parse(readFileSync(AGENTS_PATH, "utf-8"));
    } catch {
      // skip
    }
  }

  // Memory entries
  let memories: MemoryEntry[] = [];
  try {
    memories = listEntries();
  } catch {
    // Memory dir may not exist yet
  }

  // Per-agent cost: map sessionId → agentName, sum usage, fallback to transcript estimate
  const sessionToAgent = new Map<string, string>();
  for (const [name, entry] of Object.entries(agents)) {
    if (entry.sessionId) sessionToAgent.set(entry.sessionId, name);
    if (entry.formerSessionIds) {
      for (const sid of entry.formerSessionIds) sessionToAgent.set(sid, name);
    }
  }

  const agentCosts: Record<string, { cost: number; estimated: boolean }> = {};
  const agentUsageCost = new Map<string, number>();
  for (const e of usageEntries) {
    const agentName = sessionToAgent.get(e.sessionId);
    if (agentName) {
      agentUsageCost.set(agentName, (agentUsageCost.get(agentName) ?? 0) + (e.costUsd ?? 0));
    }
  }

  for (const [name, entry] of Object.entries(agents)) {
    const usageCost = agentUsageCost.get(name);
    if (usageCost !== undefined) {
      agentCosts[name] = { cost: usageCost, estimated: false };
    } else {
      // No usage data — estimate from transcript token counts
      const allSessionIds: string[] = [];
      if (entry.sessionId) allSessionIds.push(entry.sessionId);
      if (entry.formerSessionIds) allSessionIds.push(...entry.formerSessionIds);

      const cwdOverride = entry.type === "orchestrator" ? config.agent.workingDirectory : undefined;
      let totalEstimate = 0;
      for (const sid of allSessionIds) {
        totalEstimate += estimateCostFromTranscript(entry, sid, cwdOverride);
      }
      if (totalEstimate > 0) {
        agentCosts[name] = { cost: totalEstimate, estimated: true };
      }
    }
  }

  // Raw file contents for the config viewer tabs
  const healthPath = join(FRIDAY_DIR, "health.json");
  const channelsPath = join(SESSIONS_DIR, "channels.json");
  const stateFiles: Array<{ label: string; path: string; content: string | null }> = [
    {
      label: "resolved",
      path: "Resolved loaded configuration",
      content: JSON.stringify(config, null, 2),
    },
    {
      label: "config",
      path: CONFIG_PATH,
      content: existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf-8") : null,
    },
    {
      label: "health",
      path: healthPath,
      content: existsSync(healthPath) ? readFileSync(healthPath, "utf-8") : null,
    },
    {
      label: "agents",
      path: AGENTS_PATH,
      content: Object.keys(agents).length > 0 ? JSON.stringify(agents, null, 2) : null,
    },
    {
      label: "channels",
      path: channelsPath,
      content: existsSync(channelsPath) ? readFileSync(channelsPath, "utf-8") : null,
    },
  ];

  // Activity grid data (last 365 days)
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const activityByDate: Record<string, { count: number; cost: number }> = {};
  for (const e of usageEntries) {
    const ts = new Date(e.timestamp).getTime();
    if (ts < oneYearAgo) continue;
    const day = new Date(e.timestamp).toLocaleDateString("en-CA");
    if (!activityByDate[day]) activityByDate[day] = { count: 0, cost: 0 };
    activityByDate[day].count++;
    activityByDate[day].cost += e.costUsd ?? 0;
  }

  return {
    usageEntries,
    agents,
    agentCosts,
    memories,
    stateFiles,
    activityByDate,
  };
};
