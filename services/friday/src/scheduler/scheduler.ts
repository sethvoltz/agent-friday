import { CronExpressionParser } from "cron-parser";
import { listAgents, updateScheduledAgent, updateAgentStatus } from "../sessions/registry.js";
import { triggerScheduledAgent } from "./trigger.js";
import { log } from "../log.js";
import type { ScheduleSpec } from "@friday/shared";

export { validateCron, validateRunAt } from "@friday/shared";

const CHECK_INTERVAL_MS = 30_000;

let checkTimer: ReturnType<typeof setInterval> | null = null;
let schedulerModel = "claude-sonnet-4-6";

export interface SchedulerConfig {
  model: string;
}

/**
 * Start the scheduler loop. Checks every 30s for due scheduled agents.
 * Idempotent — calling twice replaces the timer but does not re-fire catch-ups.
 */
export function startScheduler(config: SchedulerConfig): void {
  schedulerModel = config.model;

  if (checkTimer) {
    // Already started — replace the timer but don't re-run restoration.
    clearInterval(checkTimer);
    checkTimer = setInterval(() => checkSchedules(), CHECK_INTERVAL_MS);
    checkTimer.unref();
    return;
  }

  // Catch up missed schedules on startup
  try {
    restoreScheduledAgents();
  } catch (err) {
    log("error", "scheduler_restore_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  checkTimer = setInterval(() => {
    checkSchedules();
  }, CHECK_INTERVAL_MS);
  checkTimer.unref();

  log("info", "scheduler_started", { intervalMs: CHECK_INTERVAL_MS });
}

/**
 * Stop the scheduler loop.
 */
export function stopScheduler(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/**
 * Single pass: check all scheduled agents and trigger any that are due.
 * Each agent is processed in isolation — one bad entry never halts the loop.
 * Exported for testing.
 */
export function checkSchedules(): void {
  const now = new Date();
  const agents = listAgents({ type: "scheduled" });

  for (const { name, entry } of agents) {
    try {
      if (entry.type !== "scheduled") continue;
      if (entry.status === "destroyed") continue;
      if (entry.paused) continue;

      // Concurrent run guard: don't trigger if already running
      if (entry.status === "active") {
        log("debug", "scheduler_skip_active", { agent: name });
        continue;
      }

      if (!entry.nextRunAt) continue;

      const nextRun = new Date(entry.nextRunAt);
      if (Number.isNaN(nextRun.getTime())) {
        log("error", "scheduler_invalid_nextRunAt", { agent: name, nextRunAt: entry.nextRunAt });
        autoPauseAgent(name, "invalid nextRunAt");
        continue;
      }
      if (nextRun > now) continue;

      // It's due — trigger it
      log("info", "scheduler_triggering", { agent: name, nextRunAt: entry.nextRunAt });

      triggerScheduledAgent(name, entry, schedulerModel);

      // Compute and store next run
      const nextRunAt = computeNextRun(entry.schedule, now);

      if (nextRunAt) {
        updateScheduledAgent(name, { nextRunAt: nextRunAt.toISOString() });
      } else {
        // One-shot: no next run, pause it
        updateScheduledAgent(name, { nextRunAt: null, paused: true });
        log("info", "scheduler_oneshot_paused", { agent: name });
      }
    } catch (err) {
      // One bad agent must not halt the entire scheduler. Auto-pause and log.
      const errorMsg = err instanceof Error ? err.message : String(err);
      log("error", "scheduler_check_failed", { agent: name, error: errorMsg });
      autoPauseAgent(name, errorMsg);
    }
  }
}

function autoPauseAgent(name: string, reason: string): void {
  try {
    updateScheduledAgent(name, { paused: true });
    log("warn", "scheduler_auto_paused", { agent: name, reason });
  } catch {
    // If we can't even pause, give up silently — listAgents will return the entry next tick
    // and the same try/catch will catch it again.
  }
}

/**
 * Compute the next run time from a schedule spec.
 * Returns null for one-shot schedules (no next occurrence) or for invalid cron expressions.
 */
export function computeNextRun(
  spec: ScheduleSpec,
  from: Date = new Date()
): Date | null {
  if (spec.cron) {
    try {
      const expr = CronExpressionParser.parse(spec.cron, {
        currentDate: from,
        tz: spec.timezone,
      });
      return expr.next().toDate();
    } catch (err) {
      log("error", "scheduler_cron_parse_failed", {
        cron: spec.cron,
        timezone: spec.timezone,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  // One-shot: runAt is the only occurrence. No "next" after it fires.
  return null;
}

/**
 * Restore scheduled agents on daemon restart.
 * - Resets any stuck "active" status (the previous run's loop is gone).
 * - Catches up at most one missed run per agent.
 * Each agent is processed in isolation.
 */
function restoreScheduledAgents(): void {
  const now = new Date();
  const agents = listAgents({ type: "scheduled" });

  for (const { name, entry } of agents) {
    try {
      if (entry.type !== "scheduled") continue;
      if (entry.status === "destroyed") continue;

      // C2: a daemon crash mid-run leaves status="active" on disk. The loop that owned that
      // run is gone — without resetting, the concurrent-run guard would skip this agent forever.
      if (entry.status === "active") {
        log("warn", "scheduler_reset_stuck_active", { agent: name });
        updateAgentStatus(name, "idle");
      }

      if (entry.paused) continue;

      if (!entry.nextRunAt) {
        // One-shot that hasn't been scheduled yet, or was already paused
        if (entry.schedule.runAt && !entry.lastRunAt) {
          const runAt = new Date(entry.schedule.runAt);
          if (Number.isNaN(runAt.getTime())) {
            log("error", "scheduler_invalid_runAt", { agent: name, runAt: entry.schedule.runAt });
            autoPauseAgent(name, "invalid runAt");
            continue;
          }
          if (runAt <= now) {
            log("info", "scheduler_catchup_oneshot", { agent: name });
            triggerScheduledAgent(name, entry, schedulerModel);
            updateScheduledAgent(name, { nextRunAt: null, paused: true });
          } else {
            updateScheduledAgent(name, { nextRunAt: entry.schedule.runAt });
          }
        }
        continue;
      }

      const nextRun = new Date(entry.nextRunAt);
      if (Number.isNaN(nextRun.getTime())) {
        log("error", "scheduler_invalid_nextRunAt", { agent: name, nextRunAt: entry.nextRunAt });
        autoPauseAgent(name, "invalid nextRunAt");
        continue;
      }
      if (nextRun <= now) {
        // Missed recurring — fire once now, then compute next from now
        log("info", "scheduler_catchup_recurring", { agent: name, missedAt: entry.nextRunAt });
        triggerScheduledAgent(name, entry, schedulerModel);

        const newNext = computeNextRun(entry.schedule, now);
        updateScheduledAgent(name, {
          nextRunAt: newNext ? newNext.toISOString() : null,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log("error", "scheduler_restore_agent_failed", { agent: name, error: errorMsg });
      autoPauseAgent(name, errorMsg);
    }
  }
}
