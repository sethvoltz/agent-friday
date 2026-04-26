import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  getAgent,
  listAgents,
  registerScheduledAgent,
  updateScheduledAgent,
} from "../sessions/registry.js";
import { destroyAgentByName } from "../agent/lifecycle.js";
import { triggerScheduledAgent } from "./trigger.js";
import { computeNextRun, validateCron, validateRunAt } from "./scheduler.js";
import type { ScheduleSpec, ScheduledEntry } from "@friday/shared";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export interface ScheduleToolsContext {
  model: string;
  defaultCwd: string;
}

/**
 * Create an MCP server with schedule management tools.
 * Available to the orchestrator for managing scheduled agents via Slack.
 */
export function createScheduleTools(ctx: ScheduleToolsContext) {
  return createSdkMcpServer({
    name: "friday-scheduler",
    tools: [
      tool(
        "schedule_create",
        "Create a new scheduled agent that runs autonomously on a cron schedule or at a specific time.",
        {
          name: z.string().describe("Agent name (lowercase, hyphens ok). Will be prefixed with 'scheduled-' if not already."),
          cron: z.string().optional().describe("5-field cron expression (e.g. '0 */6 * * *' for every 6 hours). Mutually exclusive with runAt."),
          runAt: z.string().optional().describe("ISO 8601 timestamp for one-shot execution (e.g. '2026-04-26T09:00:00Z'). Mutually exclusive with cron."),
          timezone: z.string().optional().describe("Timezone for cron evaluation (e.g. 'America/New_York'). Defaults to system local."),
          taskPrompt: z.string().describe("What the agent should do on each run. Be specific — this is the agent's entire instruction set."),
          cwd: z.string().optional().describe("Working directory for the agent. Defaults to the configured working directory."),
          systemPromptSuffix: z.string().optional().describe("Additional system prompt context for the agent's persona or role."),
        },
        async ({ name, cron, runAt, timezone, taskPrompt, cwd, systemPromptSuffix }) => {
          if (!cron && !runAt) {
            return ok("Error: must provide either 'cron' or 'runAt'.");
          }
          if (cron && runAt) {
            return ok("Error: 'cron' and 'runAt' are mutually exclusive.");
          }
          if (cron) {
            const cronError = validateCron(cron, timezone);
            if (cronError) return ok(`Error: invalid cron expression: ${cronError}`);
          }
          if (runAt) {
            const runAtError = validateRunAt(runAt);
            if (runAtError) return ok(`Error: invalid runAt — ${runAtError}`);
          }

          // Normalize name
          const agentName = name.startsWith("scheduled-") ? name : `scheduled-${name}`;

          const schedule: ScheduleSpec = {};
          if (cron) schedule.cron = cron;
          if (runAt) schedule.runAt = runAt;
          if (timezone) schedule.timezone = timezone;

          const nextRunAt = computeNextRun(schedule);
          // For one-shot, nextRunAt is null but we use runAt directly
          const effectiveNextRun = nextRunAt
            ? nextRunAt.toISOString()
            : runAt ?? null;

          try {
            const entry = registerScheduledAgent(
              agentName,
              schedule,
              taskPrompt,
              cwd ?? ctx.defaultCwd,
              effectiveNextRun,
              systemPromptSuffix
            );

            const scheduleDesc = cron ? `cron: ${cron}` : `one-shot: ${runAt}`;
            return ok(
              `Created scheduled agent "${agentName}".\n` +
              `Schedule: ${scheduleDesc}\n` +
              `Next run: ${effectiveNextRun ?? "pending"}\n` +
              `State dir: ${entry.stateDir}`
            );
          } catch (err) {
            return ok(`Error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      ),

      tool(
        "schedule_list",
        "List all scheduled agents with their status, schedule, and run history.",
        {},
        async () => {
          const agents = listAgents({ type: "scheduled" });
          if (agents.length === 0) {
            return ok("No scheduled agents.");
          }

          const lines = agents.map(({ name, entry }) => {
            if (entry.type !== "scheduled") return "";
            const sched = entry.schedule.cron
              ? `cron: ${entry.schedule.cron}`
              : `one-shot: ${entry.schedule.runAt}`;
            const status = entry.paused ? "paused" : entry.status;
            return [
              `• ${name} [${status}]`,
              `  Schedule: ${sched}`,
              `  Last run: ${entry.lastRunAt ?? "never"}`,
              `  Next run: ${entry.nextRunAt ?? "none"}`,
            ].join("\n");
          });

          return ok(lines.join("\n\n"));
        }
      ),

      tool(
        "schedule_pause",
        "Pause a scheduled agent. It will not run until resumed.",
        {
          name: z.string().describe("Scheduled agent name"),
        },
        async ({ name }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }
          updateScheduledAgent(name, { paused: true });
          return ok(`Paused "${name}". It will not run until resumed.`);
        }
      ),

      tool(
        "schedule_resume",
        "Resume a paused scheduled agent.",
        {
          name: z.string().describe("Scheduled agent name"),
        },
        async ({ name }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }

          // Recompute next run from now
          const nextRunAt = computeNextRun(entry.schedule);
          updateScheduledAgent(name, {
            paused: false,
            nextRunAt: nextRunAt ? nextRunAt.toISOString() : entry.schedule.runAt ?? null,
          });

          return ok(`Resumed "${name}". Next run: ${nextRunAt?.toISOString() ?? entry.schedule.runAt ?? "pending"}`);
        }
      ),

      tool(
        "schedule_update",
        "Update a scheduled agent's configuration.",
        {
          name: z.string().describe("Scheduled agent name"),
          cron: z.string().optional().describe("New cron expression"),
          taskPrompt: z.string().optional().describe("New task prompt"),
          systemPromptSuffix: z.string().optional().describe("New system prompt suffix"),
        },
        async ({ name, cron, taskPrompt, systemPromptSuffix }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }

          const updates: Record<string, any> = {};
          if (taskPrompt !== undefined) updates.taskPrompt = taskPrompt;
          if (systemPromptSuffix !== undefined) updates.systemPromptSuffix = systemPromptSuffix;
          if (cron !== undefined) {
            const cronError = validateCron(cron, entry.schedule.timezone);
            if (cronError) return ok(`Error: invalid cron expression: ${cronError}`);
            updates.schedule = { ...entry.schedule, cron };
            delete updates.schedule.runAt; // cron replaces one-shot
            const next = computeNextRun(updates.schedule);
            updates.nextRunAt = next ? next.toISOString() : null;
          }

          updateScheduledAgent(name, updates);
          return ok(`Updated "${name}".`);
        }
      ),

      tool(
        "schedule_delete",
        "Destroy a scheduled agent (soft delete — preserves state directory).",
        {
          name: z.string().describe("Scheduled agent name"),
        },
        async ({ name }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }
          try {
            destroyAgentByName(name);
            return ok(`Destroyed "${name}". State directory preserved at ${entry.stateDir}.`);
          } catch (err) {
            return ok(`Error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      ),

      tool(
        "schedule_trigger",
        "Manually trigger an immediate run of a scheduled agent, regardless of its schedule.",
        {
          name: z.string().describe("Scheduled agent name"),
        },
        async ({ name }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }
          if (entry.status === "active") {
            return ok(`"${name}" is already running. Wait for it to finish.`);
          }
          triggerScheduledAgent(name, entry, ctx.model);
          return ok(`Triggered "${name}" for immediate execution.`);
        }
      ),
    ],
  });
}
