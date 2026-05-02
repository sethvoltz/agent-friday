import { existsSync } from "node:fs";
import { join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  getAgent,
  listAgents,
  registerScheduledAgent,
  updateScheduledAgent,
} from "../sessions/registry.js";
import { destroyAgentByName } from "../agent/lifecycle.js";
import { triggerScheduledAgent, buildFirstTurnWithState, readInjectedFile } from "./trigger.js";
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
          taskPrompt: z.string().describe("What the agent should do on each run. The daemon automatically injects `state.md` and `last-run.md` from the agent's state directory into each run's prompt — the agent already sees its prior state without having to read it. For inter-run state (lists, cursors, progress), tell the agent to write `<stateDir>/state.md` at the end of each run. NEVER use `/tmp` for state — it's volatile. The state dir path is returned in the response."),
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
        "schedule_show",
        "Show full configuration of a scheduled agent — schedule, taskPrompt, systemPromptSuffix, state dir, and the latest state.md / last-run.md contents. Use this before schedule_update to see what's actually configured.",
        {
          name: z.string().describe("Scheduled agent name"),
        },
        async ({ name }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }

          const sched = entry.schedule.cron
            ? `cron: ${entry.schedule.cron}`
            : `one-shot: ${entry.schedule.runAt}`;
          const status = entry.paused ? "paused" : entry.status;

          const sections: string[] = [];
          sections.push(`# ${name} [${status}]`);
          sections.push("");
          sections.push(`- Schedule: ${sched}`);
          if (entry.schedule.timezone) {
            sections.push(`- Timezone: ${entry.schedule.timezone}`);
          }
          sections.push(`- CWD: ${entry.cwd}`);
          sections.push(`- State dir: ${entry.stateDir}`);
          sections.push(`- Last run: ${entry.lastRunAt ?? "never"}`);
          sections.push(`- Next run: ${entry.nextRunAt ?? "none"}`);
          sections.push(`- Created: ${entry.createdAt}`);
          if (entry.formerTaskPrompts && entry.formerTaskPrompts.length > 0) {
            sections.push(`- Prior taskPrompt versions: ${entry.formerTaskPrompts.length} (use schedule_revert to roll back)`);
          }
          sections.push("");
          sections.push("## taskPrompt");
          sections.push("```");
          sections.push(entry.taskPrompt);
          sections.push("```");
          if (entry.systemPromptSuffix) {
            sections.push("");
            sections.push("## systemPromptSuffix");
            sections.push("```");
            sections.push(entry.systemPromptSuffix);
            sections.push("```");
          }

          const statePath = join(entry.stateDir, "state.md");
          if (existsSync(statePath)) {
            sections.push("");
            sections.push("## state.md (current — auto-injected next run)");
            sections.push("```");
            sections.push(readInjectedFile(statePath));
            sections.push("```");
          }

          const lastRunPath = join(entry.stateDir, "last-run.md");
          if (existsSync(lastRunPath)) {
            sections.push("");
            sections.push("## last-run.md");
            sections.push("```");
            sections.push(readInjectedFile(lastRunPath));
            sections.push("```");
          }

          return ok(sections.join("\n"));
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

      tool(
        "schedule_revert",
        "Revert a scheduled agent's taskPrompt to its previous version. Useful when a schedule_update goes wrong — pops the most recent prior prompt off the history stack and restores it.",
        {
          name: z.string().describe("Scheduled agent name"),
        },
        async ({ name }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }
          const history = entry.formerTaskPrompts ?? [];
          if (history.length === 0) {
            return ok(`Error: "${name}" has no prior taskPrompt to revert to.`);
          }
          const [previous, ...rest] = history;
          const current = entry.taskPrompt;
          // Move current to history (so revert is itself reversible) and restore previous.
          const newHistory = [current, ...rest].slice(0, 10);
          updateScheduledAgent(name, {
            taskPrompt: previous,
            formerTaskPrompts: newHistory,
          });
          return ok(
            `Reverted "${name}" to previous taskPrompt (${history.length - 1} earlier versions still in history).`
          );
        }
      ),

      tool(
        "schedule_preview",
        "Preview the exact first-turn prompt the agent will receive on its next run — taskPrompt plus auto-injected state.md and last-run.md. Useful for debugging what the agent actually sees.",
        {
          name: z.string().describe("Scheduled agent name"),
        },
        async ({ name }) => {
          const entry = getAgent(name);
          if (!entry || entry.type !== "scheduled") {
            return ok(`Error: scheduled agent "${name}" not found.`);
          }
          const prompt = buildFirstTurnWithState(name, entry.taskPrompt, entry.stateDir, entry);
          return ok(
            `# Next-run first-turn prompt for ${name}\n\n` +
            `\`\`\`\n${prompt}\n\`\`\``
          );
        }
      ),
    ],
  });
}
