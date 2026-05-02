import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadConfig,
  SESSIONS_DIR,
  FRIDAY_DIR,
  getSessionDateRange,
  getIndexedRanges,
  getAllSessionAggregates,
  getBareSessionAggregates,
  type RegistryEntry,
} from "@friday/shared";
import type { LayoutServerLoad } from "./$types";

const NAMES_CACHE_PATH = join(FRIDAY_DIR, "slack-names.json");
const HISTORY_FILE = join(SESSIONS_DIR, "channel-history.json");

function loadNamesCache(): Record<string, string> {
  if (!existsSync(NAMES_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(NAMES_CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export interface AgentTreeNode {
  name: string;
  entry: RegistryEntry;
  children: AgentTreeNode[];
  /** Start date of the current/active session (ISO string) */
  currentSessionStart: string | null;
  /** Former session IDs with date ranges */
  formerSessions: Array<{ sessionId: string; firstAt: string; lastAt: string; turns: number }>;
}

export interface BareSessionGroup {
  channelId: string;
  label: string;
  kind: "channel" | "dm";
  currentSessionStart: string | null;
  sessions: Array<{ sessionId: string; firstAt: string; lastAt: string; turns: number; active: boolean }>;
}

export const load: LayoutServerLoad = async ({ parent }) => {
  const config = loadConfig();

  // Agent registry — inherited from the root layout.
  const { agents } = await parent();

  // Current channel sessions
  const channelsPath = join(SESSIONS_DIR, "channels.json");
  let channelSessions: Record<string, string> = {};
  if (existsSync(channelsPath)) {
    try { channelSessions = JSON.parse(readFileSync(channelsPath, "utf-8")); } catch { /* skip */ }
  }

  // Channel history (former sessions from /friday reset)
  let channelHistory: Record<string, string[]> = {};
  if (existsSync(HISTORY_FILE)) {
    try { channelHistory = JSON.parse(readFileSync(HISTORY_FILE, "utf-8")); } catch { /* skip */ }
  }

  // Slack name cache
  const slackNames = loadNamesCache();

  // ── Usage stats by sessionId — single GROUP BY query ────────
  const usageBySession = getAllSessionAggregates();

  // ── Transcript index: pre-fetch first/last timestamps for every
  //    session that the registry knows about so the per-session
  //    fallback (a partial-file read) is reserved for the rare case
  //    of an unindexed session.
  const allSessionIds: string[] = [];
  for (const entry of Object.values(agents)) {
    if (entry.sessionId) allSessionIds.push(entry.sessionId);
    if (entry.formerSessionIds) allSessionIds.push(...entry.formerSessionIds);
  }
  const indexedRanges = getIndexedRanges(allSessionIds);

  // ── Build agent tree ────────────────────────────────────────
  const orchChannelId = config.slack.orchestratorChannelId;

  // Resolve the CWD for an agent entry (used for transcript file lookups)
  function agentCwd(entry: RegistryEntry): string | null {
    if (entry.type === "orchestrator") return config.agent.workingDirectory;
    if (entry.type === "builder") return entry.workspace;
    if (entry.type === "helper") return entry.cwd;
    if (entry.type === "scheduled") return entry.cwd;
    return null;
  }

  function buildNode(name: string, entry: RegistryEntry): AgentTreeNode {
    // Orchestrator's current session is in channels.json, not the registry
    const currentSessionId = entry.sessionId
      ?? (entry.type === "orchestrator" && orchChannelId ? channelSessions[orchChannelId] ?? null : null);

    // Former sessions from registry (backfilled + maintained by daemon)
    const formerIds = entry.formerSessionIds ?? [];
    const cwd = agentCwd(entry);

    const formerSessions = formerIds
      .map((sid) => {
        const stats = usageBySession.get(sid);
        if (stats) return { sessionId: sid, ...stats };
        const indexed = indexedRanges.get(sid);
        if (indexed) return { sessionId: sid, ...indexed, turns: 0 };
        // Last-resort partial-file read for sessions not yet indexed
        // (the indexer runs every 5 min, so this is rare).
        if (cwd) {
          const range = getSessionDateRange(sid, cwd);
          if (range) return { sessionId: sid, ...range, turns: 0 };
        }
        return { sessionId: sid, firstAt: "", lastAt: "", turns: 0 };
      })
      // Drop sessions with no resolvable data — stale IDs whose transcript
      // and usage are gone show as blank rows otherwise.
      .filter((s) => s.firstAt)
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

    const children: AgentTreeNode[] = [];
    if ("children" in entry && Array.isArray(entry.children)) {
      for (const childName of entry.children) {
        const childEntry = agents[childName];
        if (childEntry) {
          children.push(buildNode(childName, childEntry));
        }
      }
    }

    // Also pick up destroyed agents that were children but may have been removed from children array
    for (const [agentName, agentEntry] of Object.entries(agents)) {
      if ("parent" in agentEntry && agentEntry.parent === name && !children.some((c) => c.name === agentName)) {
        children.push(buildNode(agentName, agentEntry));
      }
    }

    // Start date: from usage stats, transcript index, partial-file read, or createdAt
    let currentSessionStart: string | null = null;
    if (currentSessionId) {
      const stats = usageBySession.get(currentSessionId);
      if (stats) {
        currentSessionStart = stats.firstAt;
      } else {
        const indexed = indexedRanges.get(currentSessionId);
        if (indexed) {
          currentSessionStart = indexed.firstAt;
        } else if (cwd) {
          const range = getSessionDateRange(currentSessionId, cwd);
          currentSessionStart = range?.firstAt ?? entry.createdAt ?? null;
        } else {
          currentSessionStart = entry.createdAt ?? null;
        }
      }
    } else {
      currentSessionStart = entry.createdAt ?? null;
    }

    return { name, entry, children, currentSessionStart, formerSessions };
  }

  // Build tree from orchestrator root
  const orchestratorEntry = agents["orchestrator"];
  const agentTree: AgentTreeNode[] = [];
  if (orchestratorEntry) {
    agentTree.push(buildNode("orchestrator", orchestratorEntry));
  }
  // Add any orphaned builders/agents not under orchestrator
  for (const [name, entry] of Object.entries(agents)) {
    if (name === "orchestrator") continue;
    const parent = "parent" in entry ? entry.parent : null;
    if (!parent || !agents[parent]) {
      if (!agentTree.some((n) => n.name === name)) {
        agentTree.push(buildNode(name, entry));
      }
    }
  }

  // ── Build bare session groups (single GROUP BY query) ───────
  const bareByChannel = new Map<string, Map<string, { firstAt: string; lastAt: string; turns: number }>>();
  for (const r of getBareSessionAggregates()) {
    if (!r.channelId) continue;
    if (!bareByChannel.has(r.channelId)) bareByChannel.set(r.channelId, new Map());
    bareByChannel.get(r.channelId)!.set(r.sessionId, {
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      turns: r.turns,
    });
  }

  // Also add channel-history entries that may not be in usage (pre-logging resets)
  for (const [channelId, formerIds] of Object.entries(channelHistory)) {
    if (!bareByChannel.has(channelId)) bareByChannel.set(channelId, new Map());
    const sessions = bareByChannel.get(channelId)!;
    for (const sid of formerIds) {
      if (!sessions.has(sid)) {
        sessions.set(sid, { firstAt: "", lastAt: "", turns: 0 });
      }
    }
  }

  const activeSessionIds = new Set(Object.values(channelSessions));
  const orchestratorChannelId = config.slack.orchestratorChannelId;

  const bareSessionGroups: BareSessionGroup[] = [...bareByChannel.entries()]
    .filter(([channelId]) => channelId !== orchestratorChannelId)
    .map(([channelId, sessions]) => {
      const name = slackNames[channelId];
      const activeSession = [...sessions.entries()].find(([sid]) => activeSessionIds.has(sid));
      const activeStats = activeSession ? usageBySession.get(activeSession[0]) : null;
      return {
        channelId,
        label: name ?? (channelId.startsWith("D") ? `DM (${channelId})` : `#${channelId}`),
        kind: (channelId.startsWith("D") ? "dm" : "channel") as "dm" | "channel",
        currentSessionStart: activeStats?.firstAt ?? null,
        sessions: [...sessions.entries()]
          .map(([sessionId, stats]) => ({
            sessionId,
            ...stats,
            active: activeSessionIds.has(sessionId),
          }))
          .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
      };
    })
    .sort((a, b) => {
      const aLatest = a.sessions[0]?.lastAt ?? "";
      const bLatest = b.sessions[0]?.lastAt ?? "";
      return bLatest.localeCompare(aLatest);
    });

  return {
    agentTree,
    bareSessionGroups,
    config: { workingDirectory: config.agent.workingDirectory },
  };
};
