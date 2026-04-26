import { join } from "node:path";
import { FRIDAY_DIR } from "./config.js";

export const AGENTS_PATH = join(FRIDAY_DIR, "agents.json");
export const REPOS_DIR = join(FRIDAY_DIR, "repos");
export const BEADS_DIR = join(FRIDAY_DIR, "beads");
export const SCHEDULES_DIR = join(FRIDAY_DIR, "schedules");

export type AgentType = "orchestrator" | "builder" | "helper" | "scheduled";
/** Session type includes AgentType plus "bare" for untyped Slack sessions (DMs, non-orchestrator channels) */
export type SessionType = AgentType | "bare";
export type AgentStatus = "active" | "idle" | "destroyed";

export interface OrchestratorEntry {
  type: "orchestrator";
  sessionId: string | null;
  status: AgentStatus;
  createdAt: string;
  children: string[];
  /** Previous session IDs (most recent first), preserved on reset */
  formerSessionIds?: string[];
}

export interface BuilderEntry {
  type: "builder";
  parent: string;
  sessionId: string | null;
  status: AgentStatus;
  workspace: string;
  epicId: string | null;
  createdAt: string;
  children: string[];
  /** Previous session IDs (most recent first), preserved on reset/recreate */
  formerSessionIds?: string[];
}

export interface HelperEntry {
  type: "helper";
  parent: string;
  sessionId: string | null;
  status: AgentStatus;
  taskId: string | null;
  cwd: string;
  createdAt: string;
  /** Previous session IDs (most recent first), preserved on reset/recreate */
  formerSessionIds?: string[];
}

export interface ScheduleSpec {
  /** Standard 5-field cron expression (min hour dom month dow) for recurring */
  cron?: string;
  /** ISO 8601 timestamp for one-shot execution */
  runAt?: string;
  /** Timezone for cron evaluation (default: system local) */
  timezone?: string;
}

export interface ScheduledEntry {
  type: "scheduled";
  sessionId: string | null;
  status: AgentStatus;
  createdAt: string;
  /** The schedule that triggers this agent */
  schedule: ScheduleSpec;
  /** What the agent should do on each trigger */
  taskPrompt: string;
  /** Working directory for agent sessions */
  cwd: string;
  /** Per-agent state directory (~/.friday/schedules/<name>/) */
  stateDir: string;
  /** Optional system prompt suffix for agent persona/role context */
  systemPromptSuffix?: string;
  /** ISO timestamp of last successful execution */
  lastRunAt: string | null;
  /** ISO timestamp of next scheduled run */
  nextRunAt: string | null;
  /** Whether the schedule is paused */
  paused: boolean;
  /** Previous session IDs (most recent first), preserved across runs */
  formerSessionIds?: string[];
}

export type RegistryEntry = OrchestratorEntry | BuilderEntry | HelperEntry | ScheduledEntry;

export interface AgentRegistry {
  [name: string]: RegistryEntry;
}

/**
 * Validate an agent name: lowercase alphanumeric, hyphens, no leading/trailing hyphen.
 */
export function isValidAgentName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 2;
}

/**
 * Generate a namespaced agent name.
 * Builders: "builder-<project>"
 * Agents: "agent-<parent-project>-<descriptor>"
 */
export function buildAgentName(
  type: "builder" | "helper" | "scheduled",
  parentName: string,
  descriptor: string
): string {
  const safe = descriptor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (type === "builder") {
    return `builder-${safe}`;
  }
  if (type === "scheduled") {
    return `scheduled-${safe}`;
  }
  // For helpers, namespace under parent. Strip "builder-" prefix from parent for brevity.
  const parentShort = parentName.replace(/^builder-/, "");
  return `helper-${parentShort}-${safe}`;
}
