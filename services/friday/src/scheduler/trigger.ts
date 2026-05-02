import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ScheduledEntry } from "@friday/shared";
import {
  updateAgentSession,
  updateAgentStatus,
  updateScheduledAgent,
  getAgent,
} from "../sessions/registry.js";
import { buildAgentSystemPrompt } from "../agent/prime.js";
import { createMailTools } from "../comms/mail-tools.js";
import { logUsage } from "../monitor/usage.js";
import { log } from "../log.js";
import { eventBus } from "../events/bus.js";

/** Maximum turns a single scheduled run may consume before being aborted. */
const MAX_TURNS_PER_RUN = 50;
/** Maximum wall-clock duration of a single scheduled run before being aborted. */
const MAX_RUN_DURATION_MS = 30 * 60_000; // 30 minutes
/** Maximum bytes of state.md / last-run.md injected into the next run's prompt. */
const MAX_INJECTED_STATE_BYTES = 64 * 1024;

interface InFlightRun {
  abort: AbortController;
  promise: Promise<void>;
}

/** Tracks scheduled runs that are currently executing, so shutdown can drain them. */
const inFlightRuns = new Map<string, InFlightRun>();

/**
 * Trigger a single run of a scheduled agent.
 * Spawns a fresh session, runs to completion, then marks the agent idle.
 */
export function triggerScheduledAgent(
  name: string,
  entry: ScheduledEntry,
  model: string
): void {
  // Mark as active immediately
  updateAgentStatus(name, "active");
  eventBus.publish({ type: "schedule:triggered", agentName: name });

  const startTime = Date.now();
  const abort = new AbortController();

  const promise = runScheduledTask(name, entry, model, startTime, abort.signal)
    .catch((err) => {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const aborted = abort.signal.aborted;

      log("error", "scheduled_run_failed", { agent: name, error: errorMsg, durationMs, aborted });
      eventBus.publish({ type: "schedule:failed", agentName: name, error: errorMsg });
      writeLastRun(entry.stateDir, {
        timestamp: new Date().toISOString(),
        durationMs,
        status: aborted ? "aborted" : "failed",
        error: errorMsg,
      });

      // Reset status only if the agent wasn't destroyed mid-run.
      const live = getAgent(name);
      if (live && live.status !== "destroyed") {
        updateAgentStatus(name, "idle");
      }
      updateScheduledAgent(name, { lastRunAt: new Date().toISOString() });
    })
    .finally(() => {
      inFlightRuns.delete(name);
    });

  inFlightRuns.set(name, { abort, promise });
}

/**
 * Abort all in-flight scheduled runs and wait for them to finish.
 * Called during daemon shutdown to avoid orphaned SDK subprocesses.
 */
export async function drainScheduledRuns(timeoutMs = 10_000): Promise<void> {
  if (inFlightRuns.size === 0) return;

  log("info", "scheduler_drain_start", { count: inFlightRuns.size });

  for (const { abort } of inFlightRuns.values()) {
    abort.abort();
  }

  const promises = Array.from(inFlightRuns.values()).map((r) => r.promise);
  await Promise.race([
    Promise.all(promises),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  // Anything still in flight after the timeout: force-reset their status so
  // restoreScheduledAgents on next boot doesn't have to deal with it.
  for (const name of inFlightRuns.keys()) {
    log("warn", "scheduler_drain_timeout", { agent: name });
    try {
      updateAgentStatus(name, "idle");
    } catch {
      /* ignore */
    }
  }
  inFlightRuns.clear();

  log("info", "scheduler_drain_complete", {});
}

async function runScheduledTask(
  name: string,
  entry: ScheduledEntry,
  model: string,
  startTime: number,
  abortSignal: AbortSignal
): Promise<void> {
  const { cwd, stateDir, taskPrompt } = entry;

  // Ensure state directory exists
  mkdirSync(stateDir, { recursive: true });

  // Build the first-turn prompt with state injection
  const prompt = buildFirstTurnWithState(name, taskPrompt, stateDir, entry);

  // Build the system prompt
  const scheduleDesc = entry.schedule.cron
    ? `cron: ${entry.schedule.cron}`
    : `one-shot: ${entry.schedule.runAt}`;

  const systemPrompt = buildAgentSystemPrompt({
    agentName: name,
    agentType: "scheduled",
    cwd,
    stateDir,
    scheduleDescription: scheduleDesc,
    systemPromptSuffix: entry.systemPromptSuffix,
  });

  const mailMcp = createMailTools({ callerName: name });

  // Archive current sessionId (capped — scheduled agents would otherwise accumulate
  // unbounded history and slow every dashboard load that iterates former sessions).
  const FORMER_SESSION_CAP = 20;
  if (entry.sessionId) {
    const former = [entry.sessionId, ...(entry.formerSessionIds ?? [])].slice(
      0,
      FORMER_SESSION_CAP
    );
    updateScheduledAgent(name, { formerSessionIds: former });
  }

  const queryOptions: Record<string, any> = {
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    cwd,
    model,
    permissionMode: "bypassPermissions",
    abortController: { signal: abortSignal },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPrompt,
    },
    mcpServers: {
      "friday-mail": mailMcp,
    },
  };

  let sessionId: string | undefined;
  let turnNumber = 0;
  let timedOut = false;

  // Wall-clock timeout — fires the same AbortSignal.
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    log("warn", "scheduled_run_timeout", { agent: name, durationMs: Date.now() - startTime });
    // We can't directly call abort() on the consumer's controller, so we throw via
    // the iterator. Easiest: trigger our own abort by setting a flag the loop checks,
    // and break out. We also try to abort the SDK by signaling its controller.
    if (!abortSignal.aborted) {
      // Best-effort — if the SDK respects this signal, it'll terminate cleanly.
      try { (abortSignal as any).dispatchEvent?.(new Event("abort")); } catch { /* ignore */ }
    }
  }, MAX_RUN_DURATION_MS);

  log("info", "scheduled_run_start", { agent: name });

  try {
    for await (const message of query({ prompt, options: queryOptions })) {
      if (abortSignal.aborted || timedOut) break;
      if (turnNumber >= MAX_TURNS_PER_RUN) {
        log("warn", "scheduled_run_max_turns", { agent: name, turns: turnNumber });
        break;
      }

      if (message.type === "result") {
        if (message.subtype === "success") {
          sessionId = message.session_id;
          updateAgentSession(name, sessionId);
          turnNumber++;

          const usage = (message as any).usage;
          const costUsd = (message as any).total_cost_usd ?? null;
          const durationMs = (message as any).duration_ms ?? 0;

          logUsage({
            timestamp: new Date().toISOString(),
            channelId: "",
            sessionType: "scheduled",
            sessionId,
            model,
            costUsd,
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
            cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
            turnNumber,
            durationMs,
          }, name);
        } else {
          log("error", "scheduled_turn_failed", {
            agent: name,
            subtype: message.subtype,
          });
        }
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  const totalDurationMs = Date.now() - startTime;
  const status = abortSignal.aborted
    ? "aborted"
    : timedOut
      ? "timed_out"
      : turnNumber >= MAX_TURNS_PER_RUN
        ? "turn_limit"
        : "completed";

  // Write last-run metadata
  writeLastRun(stateDir, {
    timestamp: new Date().toISOString(),
    durationMs: totalDurationMs,
    sessionId: sessionId ?? null,
    turns: turnNumber,
    status,
  });

  // Reset status only if the agent wasn't destroyed mid-run.
  const live = getAgent(name);
  if (live && live.status !== "destroyed") {
    updateAgentStatus(name, "idle");
  }
  updateScheduledAgent(name, { lastRunAt: new Date().toISOString() });

  eventBus.publish({ type: "schedule:completed", agentName: name, durationMs: totalDurationMs });

  log("info", "scheduled_run_complete", {
    agent: name,
    sessionId,
    turns: turnNumber,
    durationMs: totalDurationMs,
    status,
  });
}

/**
 * Build the first-turn prompt the scheduler hands to a freshly spawned agent:
 * the persistent task prompt plus auto-injected `state.md` and `last-run.md`
 * from the agent's state directory. Exported so `schedule_preview` can show
 * the orchestrator (and user) exactly what the agent will see next run.
 */
export function buildFirstTurnWithState(
  name: string,
  taskPrompt: string,
  stateDir: string,
  entry: ScheduledEntry
): string {
  const parts: string[] = [];

  parts.push(`You are scheduled agent "${name}". Execute your task now.\n`);

  // Inject previous run state if available — capped to prevent prompt blow-up
  // and to bound the cost of a runaway state file.
  const statePath = join(stateDir, "state.md");
  if (existsSync(statePath)) {
    const state = readInjectedFile(statePath);
    if (state) {
      parts.push("## State from your previous run\n");
      parts.push(state);
      parts.push("");
    }
  }

  // Inject last-run metadata if available
  const lastRunPath = join(stateDir, "last-run.md");
  if (existsSync(lastRunPath)) {
    const lastRun = readInjectedFile(lastRunPath);
    if (lastRun) {
      parts.push("## Last run metadata\n");
      parts.push(lastRun);
      parts.push("");
    }
  }

  parts.push("## Your task\n");
  parts.push(taskPrompt);

  return parts.join("\n");
}

/**
 * Read a file for prompt injection, capping its size to prevent prompt blow-up.
 * Returns trimmed content, with a truncation marker if the file was over the cap.
 * Exported so `schedule_show` can preview state.md / last-run.md with the same cap.
 */
export function readInjectedFile(path: string): string {
  const raw = readFileSync(path, "utf-8");
  if (raw.length <= MAX_INJECTED_STATE_BYTES) return raw.trim();
  const head = raw.slice(0, MAX_INJECTED_STATE_BYTES);
  return (
    head.trim() +
    `\n\n[truncated at ${MAX_INJECTED_STATE_BYTES} bytes — original was ${raw.length} bytes]`
  );
}

function writeLastRun(
  stateDir: string,
  data: Record<string, unknown>
): void {
  mkdirSync(stateDir, { recursive: true });
  const lines = Object.entries(data)
    .map(([k, v]) => {
      const value =
        v == null
          ? ""
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      return `- **${k}:** ${value}`;
    })
    .join("\n");
  writeFileSync(join(stateDir, "last-run.md"), lines + "\n");
}
