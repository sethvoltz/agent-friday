import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  AGENTS_PATH,
  USAGE_LOG_PATH,
  SESSIONS_DIR,
  loadConfig,
  resolveTranscriptPath,
  parseTranscript,
  getSessionDateRange,
  type AgentRegistry,
  type RegistryEntry,
  type UsageEntry,
  type Turn,
} from "@friday/shared";

export interface ScheduledRun {
  sessionId: string;
  firstAt: string;
  lastAt: string;
  isCurrent: boolean;
}
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const { name, sessionId: requestedSessionId } = params;
  const config = loadConfig();

  // Load registry
  let agents: AgentRegistry = {};
  if (existsSync(AGENTS_PATH)) {
    try { agents = JSON.parse(readFileSync(AGENTS_PATH, "utf-8")); } catch { /* skip */ }
  }

  const entry = agents[name] ?? null;

  // Determine which session to show
  let sessionId = requestedSessionId ?? entry?.sessionId ?? null;

  // Orchestrator's sessionId is tracked in channels.json, not agents.json
  if (!sessionId && entry?.type === "orchestrator") {
    const channelsPath = join(SESSIONS_DIR, "channels.json");
    if (existsSync(channelsPath)) {
      try {
        const channels: Record<string, string> = JSON.parse(readFileSync(channelsPath, "utf-8"));
        const orchChannelId = config.slack.orchestratorChannelId;
        if (orchChannelId && channels[orchChannelId]) {
          sessionId = channels[orchChannelId];
        }
      } catch { /* skip */ }
    }
  }

  // If still no session, find most recent from usage
  if (!sessionId && entry) {
    if (existsSync(USAGE_LOG_PATH)) {
      const lines = readFileSync(USAGE_LOG_PATH, "utf-8").split("\n").filter((l) => l.trim());
      let latest: { sessionId: string; timestamp: string } | null = null;
      for (const line of lines) {
        try {
          const e: UsageEntry = JSON.parse(line);
          if (entry.sessionId === e.sessionId || e.sessionType === entry.type) {
            if (!latest || e.timestamp > latest.timestamp) {
              latest = { sessionId: e.sessionId, timestamp: e.timestamp };
            }
          }
        } catch { /* skip */ }
      }
      if (latest) sessionId = latest.sessionId;
    }
  }

  // Load transcript
  let turns: Turn[] = [];
  let totalTurns = 0;

  if (sessionId && entry) {
    const cwdOverride = entry.type === "orchestrator" ? config.agent.workingDirectory : undefined;
    // Build a temporary entry with the requested sessionId (may differ from current)
    const lookupEntry: RegistryEntry = { ...entry, sessionId };
    const jsonlPath = resolveTranscriptPath(lookupEntry, cwdOverride);

    if (jsonlPath && existsSync(jsonlPath)) {
      try {
        turns = await parseTranscript(jsonlPath);
        totalTurns = turns.length;
      } catch { /* skip */ }
    }
  }

  // Session stats from usage log
  let stats: { turns: number; cost: number; firstAt: string; lastAt: string } | null = null;
  if (sessionId && existsSync(USAGE_LOG_PATH)) {
    const lines = readFileSync(USAGE_LOG_PATH, "utf-8").split("\n").filter((l) => l.trim());
    let turnCount = 0;
    let cost = 0;
    let firstAt = "";
    let lastAt = "";
    for (const line of lines) {
      try {
        const e: UsageEntry = JSON.parse(line);
        if (e.sessionId === sessionId) {
          turnCount++;
          cost += e.costUsd ?? 0;
          if (!firstAt) firstAt = e.timestamp;
          lastAt = e.timestamp;
        }
      } catch { /* skip */ }
    }
    if (turnCount > 0) {
      stats = { turns: turnCount, cost, firstAt, lastAt };
    }
  }

  const isFormer = requestedSessionId != null || (entry?.status === "destroyed");

  // For scheduled agents, build the list of runs (current + formers) for the run picker.
  let scheduledRuns: ScheduledRun[] | null = null;
  if (entry?.type === "scheduled") {
    const cwd = entry.cwd;
    const currentSessionId = entry.sessionId;
    const formerIds = entry.formerSessionIds ?? [];

    // Build usage stats lookup for these sessions
    const sessionStats = new Map<string, { firstAt: string; lastAt: string }>();
    if (existsSync(USAGE_LOG_PATH)) {
      const lines = readFileSync(USAGE_LOG_PATH, "utf-8").split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const e: UsageEntry = JSON.parse(line);
          if (e.sessionId === currentSessionId || formerIds.includes(e.sessionId)) {
            const existing = sessionStats.get(e.sessionId);
            if (existing) {
              existing.lastAt = e.timestamp;
            } else {
              sessionStats.set(e.sessionId, { firstAt: e.timestamp, lastAt: e.timestamp });
            }
          }
        } catch { /* skip */ }
      }
    }

    const allIds = currentSessionId ? [currentSessionId, ...formerIds] : [...formerIds];
    scheduledRuns = allIds.map((sid) => {
      const stats = sessionStats.get(sid);
      let firstAt = stats?.firstAt ?? "";
      let lastAt = stats?.lastAt ?? "";
      if (!firstAt) {
        const range = getSessionDateRange(sid, cwd);
        if (range) {
          firstAt = range.firstAt;
          lastAt = range.lastAt;
        }
      }
      return {
        sessionId: sid,
        firstAt,
        lastAt,
        isCurrent: sid === currentSessionId,
      };
    });
  }

  return {
    agentName: name,
    entry,
    sessionId,
    turns,
    totalTurns,
    stats,
    isFormer,
    scheduledRuns,
  };
};
