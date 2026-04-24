import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentType } from "@friday/shared";
import {
  registerBuilder,
  registerAgent,
  registerOrchestrator,
  updateAgentSession,
  updateAgentStatus,
  destroyAgent as registryDestroy,
  getAgent,
  listAgents,
} from "../sessions/registry.js";
import {
  createWorkspace,
  destroyWorkspace,
  type RepoSource,
} from "./workspace.js";
import { buildAgentSystemPrompt, buildFirstTurnPrompt } from "./prime.js";
import { log } from "../log.js";

/** Tracks running agent loops by agent name */
const runningAgents = new Map<
  string,
  { abort: AbortController; sessionId: string | null }
>();

export interface CreateBuilderOptions {
  name: string;
  workingDirectory: string;
  repos: RepoSource[];
  epicId: string | null;
  model: string;
  allowedTools?: string[];
  mcpServers?: Record<string, any>;
}

export interface CreateAgentOptions {
  name: string;
  parent: string;
  taskId: string | null;
  cwd: string;
  model: string;
  allowedTools?: string[];
  mcpServers?: Record<string, any>;
}

/**
 * Initialize the Orchestrator in the registry.
 * Called once at daemon startup. Does not spawn a loop —
 * the Orchestrator's session is managed by the Slack event handler.
 */
export function initOrchestrator(): void {
  registerOrchestrator();
}

/**
 * Create a new Builder agent: register, create workspace, spawn session loop.
 */
export async function createBuilder(
  options: CreateBuilderOptions
): Promise<{ workspace: string }> {
  const {
    name,
    workingDirectory,
    repos,
    epicId,
    model,
    allowedTools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
    mcpServers,
  } = options;

  // Create workspace first — if this fails, we don't register
  const workspaceInfo = createWorkspace({
    builderName: name,
    workingDirectory,
    repos,
  });

  // Register in agent registry
  registerBuilder(name, "orchestrator", workspaceInfo.path, epicId);

  // Spawn the agent loop
  spawnAgentLoop({
    agentName: name,
    agentType: "builder",
    cwd: workspaceInfo.path,
    model,
    allowedTools,
    mcpServers,
    epicId,
    parent: "orchestrator",
    workspace: workspaceInfo.path,
  });

  log("info", "builder_created", {
    name,
    workspace: workspaceInfo.path,
    epicId,
    worktreeCount: workspaceInfo.worktrees.length,
  });

  return { workspace: workspaceInfo.path };
}

/**
 * Create a new Agent: register and spawn session loop.
 */
export async function createAgentAgent(
  options: CreateAgentOptions
): Promise<void> {
  const {
    name,
    parent,
    taskId,
    cwd,
    model,
    allowedTools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
    mcpServers,
  } = options;

  registerAgent(name, parent, taskId, cwd);

  spawnAgentLoop({
    agentName: name,
    agentType: "agent",
    cwd,
    model,
    allowedTools,
    mcpServers,
    taskId,
    parent,
  });

  log("info", "agent_agent_created", { name, parent, taskId, cwd });
}

/**
 * Destroy an agent: stop its loop, destroy workspace (if builder), update registry.
 */
export function destroyAgentByName(name: string): void {
  const entry = getAgent(name);
  if (!entry) {
    throw new Error(`Agent "${name}" not found`);
  }

  // Stop the running loop
  stopAgentLoop(name);

  // Workspace is NOT deleted here — soft delete only.
  // Workspace cleanup is a separate, user-directed action.
  if (entry.type === "builder" && entry.workspace) {
    log("info", "workspace_preserved", {
      name,
      workspace: entry.workspace,
    });
  }

  // Update registry (recursively destroys children)
  registryDestroy(name);

  log("info", "agent_destroyed_lifecycle", { name, type: entry.type });
}

/**
 * List running agents with their current state.
 */
export function getRunningAgents(): Array<{
  name: string;
  type: AgentType;
  status: string;
  running: boolean;
}> {
  return listAgents({ status: "active" }).map(({ name, entry }) => ({
    name,
    type: entry.type,
    status: entry.status,
    running: runningAgents.has(name),
  }));
}

/**
 * Check if an agent's loop is currently running.
 */
export function isAgentRunning(name: string): boolean {
  return runningAgents.has(name);
}

// ── Internal: Agent Loop ──────────────────────────────────────────

interface SpawnOptions {
  agentName: string;
  agentType: AgentType;
  cwd: string;
  model: string;
  allowedTools: string[];
  mcpServers?: Record<string, any>;
  epicId?: string | null;
  taskId?: string | null;
  parent?: string;
  workspace?: string;
  /** Resume an existing session instead of starting fresh */
  resumeSessionId?: string;
}

function spawnAgentLoop(options: SpawnOptions): void {
  const abort = new AbortController();
  runningAgents.set(options.agentName, {
    abort,
    sessionId: options.resumeSessionId ?? null,
  });

  // Fire and forget — the loop runs in the background
  runAgentLoop(options, abort.signal).catch((err) => {
    log("error", "agent_loop_error", {
      agent: options.agentName,
      error: err instanceof Error ? err.message : String(err),
    });
    updateAgentStatus(options.agentName, "idle");
    runningAgents.delete(options.agentName);
  });
}

async function runAgentLoop(
  options: SpawnOptions,
  signal: AbortSignal
): Promise<void> {
  const {
    agentName,
    agentType,
    cwd,
    model,
    allowedTools,
    mcpServers,
  } = options;

  const systemPrompt = buildAgentSystemPrompt({
    agentName,
    agentType,
    epicId: options.epicId,
    taskId: options.taskId,
    cwd,
    parent: options.parent,
    workspace: options.workspace,
  });

  const firstTurnPrompt = buildFirstTurnPrompt({
    agentName,
    agentType,
    epicId: options.epicId,
    taskId: options.taskId,
    cwd,
    parent: options.parent,
    workspace: options.workspace,
  });

  let sessionId = options.resumeSessionId ?? undefined;
  let prompt = sessionId ? undefined : firstTurnPrompt;

  // If resuming without a prompt, provide a check-in
  if (sessionId && !prompt) {
    prompt =
      "You have been resumed after a restart. Check your current task status " +
      "with `bd ready --json` and continue where you left off.";
  }

  const queryOptions: Record<string, any> = {
    allowedTools,
    cwd,
    model,
    permissionMode: "bypassPermissions",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPrompt,
    },
  };

  if (mcpServers) {
    queryOptions.mcpServers = mcpServers;
  }

  // Run the first turn
  log("info", "agent_loop_start", { agent: agentName, resuming: !!sessionId });

  if (sessionId) {
    queryOptions.resume = sessionId;
  }

  try {
    for await (const message of query({
      prompt: prompt!,
      options: queryOptions,
    })) {
      if (signal.aborted) break;

      if (message.type === "result") {
        if (message.subtype === "success") {
          sessionId = message.session_id;
          updateAgentSession(agentName, sessionId);
          const running = runningAgents.get(agentName);
          if (running) {
            running.sessionId = sessionId;
          }

          log("info", "agent_turn_complete", {
            agent: agentName,
            sessionId,
          });
        } else {
          log("error", "agent_turn_failed", {
            agent: agentName,
            subtype: message.subtype,
          });
        }
      }
    }
  } catch (err) {
    log("error", "agent_loop_query_error", {
      agent: agentName,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // After the first turn completes, mark as idle
  // Phase 2 will add a mail-check loop here
  if (!signal.aborted) {
    updateAgentStatus(agentName, "idle");
    log("info", "agent_loop_idle", { agent: agentName });
  }

  runningAgents.delete(agentName);
}

function stopAgentLoop(name: string): void {
  const running = runningAgents.get(name);
  if (running) {
    running.abort.abort();
    runningAgents.delete(name);
    log("info", "agent_loop_stopped", { agent: name });
  }
}

/**
 * Restore active agents from the registry on daemon restart.
 * Re-spawns loops for agents that were active before shutdown.
 */
export function restoreActiveAgents(
  model: string,
  mcpServers?: Record<string, any>
): void {
  const activeAgents = listAgents({ status: "active" });

  for (const { name, entry } of activeAgents) {
    // Skip orchestrator — its session is managed by Slack events
    if (entry.type === "orchestrator") continue;

    if (!entry.sessionId) {
      log("warn", "agent_restore_skip_no_session", { agent: name });
      updateAgentStatus(name, "idle");
      continue;
    }

    log("info", "agent_restore", {
      agent: name,
      type: entry.type,
      sessionId: entry.sessionId,
    });

    spawnAgentLoop({
      agentName: name,
      agentType: entry.type,
      cwd:
        entry.type === "builder"
          ? entry.workspace
          : entry.cwd,
      model,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
      mcpServers,
      epicId: entry.type === "builder" ? entry.epicId : undefined,
      taskId: entry.type === "agent" ? entry.taskId : undefined,
      parent: entry.parent,
      workspace: entry.type === "builder" ? entry.workspace : undefined,
      resumeSessionId: entry.sessionId,
    });
  }
}
