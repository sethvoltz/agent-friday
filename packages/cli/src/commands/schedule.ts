import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  AGENTS_PATH,
  SCHEDULES_DIR,
  atomicWriteFileSync,
  validateCron,
  type AgentRegistry,
  type ScheduledEntry,
  type ScheduleSpec,
  isValidAgentName,
  FRIDAY_DIR,
} from "@friday/shared";

function loadRegistry(): AgentRegistry {
  if (!existsSync(AGENTS_PATH)) return {};
  // Throw on parse failure — better to fail loudly than to write back `{}` on save,
  // which would wipe out the entire registry.
  return JSON.parse(readFileSync(AGENTS_PATH, "utf-8"));
}

function saveRegistry(registry: AgentRegistry): void {
  atomicWriteFileSync(AGENTS_PATH, JSON.stringify(registry, null, 2));
}

function getScheduled(registry: AgentRegistry): Array<[string, ScheduledEntry]> {
  return Object.entries(registry).filter(
    ([, e]) => e.type === "scheduled"
  ) as Array<[string, ScheduledEntry]>;
}

export function scheduleCommand(args: string[]): void {
  const sub = args[0];

  switch (sub) {
    case "list":
    case undefined:
      listSchedules();
      break;
    case "create":
      createSchedule(args.slice(1));
      break;
    case "pause":
      pauseSchedule(args[1]);
      break;
    case "resume":
      resumeSchedule(args[1]);
      break;
    case "trigger":
      triggerSchedule(args[1]);
      break;
    case "delete":
      deleteSchedule(args[1]);
      break;
    default:
      console.error(`Unknown schedule subcommand: ${sub}`);
      console.error("Available: list, create, pause, resume, trigger, delete");
      process.exit(1);
  }
}

function listSchedules(): void {
  const registry = loadRegistry();
  const scheduled = getScheduled(registry);

  if (scheduled.length === 0) {
    console.log("No scheduled agents.");
    return;
  }

  console.log("\nScheduled Agents");
  console.log("\u2550".repeat(50));

  for (const [name, entry] of scheduled) {
    const sched = entry.schedule.cron
      ? `cron: ${entry.schedule.cron}`
      : `one-shot: ${entry.schedule.runAt}`;
    const status = entry.status === "destroyed"
      ? "destroyed"
      : entry.paused
        ? "paused"
        : entry.status;

    console.log(`\n  ${name} [${status}]`);
    console.log(`    Schedule:  ${sched}`);
    if (entry.schedule.timezone) {
      console.log(`    Timezone:  ${entry.schedule.timezone}`);
    }
    console.log(`    Last run:  ${entry.lastRunAt ?? "never"}`);
    console.log(`    Next run:  ${entry.nextRunAt ?? "none"}`);
    console.log(`    State dir: ${entry.stateDir}`);
  }

  console.log();
}

function createSchedule(args: string[]): void {
  let name = "";
  let cron = "";
  let runAt = "";
  let timezone = "";
  let taskPrompt = "";
  let cwd = join(FRIDAY_DIR, "working");
  let systemPromptSuffix = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--name":
        name = args[++i] ?? "";
        break;
      case "--cron":
        cron = args[++i] ?? "";
        break;
      case "--run-at":
        runAt = args[++i] ?? "";
        break;
      case "--timezone":
      case "--tz":
        timezone = args[++i] ?? "";
        break;
      case "--task":
        taskPrompt = args[++i] ?? "";
        break;
      case "--cwd":
        cwd = args[++i] ?? cwd;
        break;
      case "--system-prompt":
        systemPromptSuffix = args[++i] ?? "";
        break;
    }
  }

  if (!name) {
    console.error("Error: --name is required");
    process.exit(1);
  }
  if (!cron && !runAt) {
    console.error("Error: --cron or --run-at is required");
    process.exit(1);
  }
  if (!taskPrompt) {
    console.error("Error: --task is required");
    process.exit(1);
  }

  const agentName = name.startsWith("scheduled-") ? name : `scheduled-${name}`;

  if (!isValidAgentName(agentName)) {
    console.error(`Error: invalid agent name "${agentName}"`);
    process.exit(1);
  }

  if (cron) {
    const cronError = validateCron(cron, timezone || undefined);
    if (cronError) {
      console.error(`Error: invalid cron expression: ${cronError}`);
      process.exit(1);
    }
  }
  if (runAt) {
    if (Number.isNaN(Date.parse(runAt))) {
      console.error(`Error: --run-at must be a valid ISO 8601 timestamp (got ${JSON.stringify(runAt)})`);
      process.exit(1);
    }
  }

  const registry = loadRegistry();
  if (registry[agentName]) {
    console.error(`Error: agent "${agentName}" already exists (status: ${registry[agentName].status})`);
    process.exit(1);
  }

  const schedule: ScheduleSpec = {};
  if (cron) schedule.cron = cron;
  if (runAt) schedule.runAt = runAt;
  if (timezone) schedule.timezone = timezone;

  const stateDir = join(SCHEDULES_DIR, agentName);
  mkdirSync(stateDir, { recursive: true });

  // For cron, compute next run. For one-shot, use runAt.
  const nextRunAt = runAt || null;

  const entry: ScheduledEntry = {
    type: "scheduled",
    sessionId: null,
    status: "idle",
    createdAt: new Date().toISOString(),
    schedule,
    taskPrompt,
    cwd,
    stateDir,
    lastRunAt: null,
    nextRunAt,
    paused: false,
  };

  if (systemPromptSuffix) {
    entry.systemPromptSuffix = systemPromptSuffix;
  }

  registry[agentName] = entry;
  saveRegistry(registry);

  console.log(`Created scheduled agent "${agentName}"`);
  console.log(`  Schedule: ${cron ? `cron: ${cron}` : `one-shot: ${runAt}`}`);
  console.log(`  State dir: ${stateDir}`);
  console.log("\nNote: the daemon's scheduler will compute the next run time on its next check cycle.");
}

function pauseSchedule(name: string | undefined): void {
  if (!name) {
    console.error("Error: agent name required");
    process.exit(1);
  }

  const registry = loadRegistry();
  const entry = registry[name];
  if (!entry || entry.type !== "scheduled") {
    console.error(`Error: scheduled agent "${name}" not found`);
    process.exit(1);
  }

  (entry as ScheduledEntry).paused = true;
  saveRegistry(registry);
  console.log(`Paused "${name}".`);
}

function resumeSchedule(name: string | undefined): void {
  if (!name) {
    console.error("Error: agent name required");
    process.exit(1);
  }

  const registry = loadRegistry();
  const entry = registry[name];
  if (!entry || entry.type !== "scheduled") {
    console.error(`Error: scheduled agent "${name}" not found`);
    process.exit(1);
  }

  (entry as ScheduledEntry).paused = false;
  saveRegistry(registry);
  console.log(`Resumed "${name}". The daemon will pick it up on its next check cycle.`);
}

function triggerSchedule(name: string | undefined): void {
  if (!name) {
    console.error("Error: agent name required");
    process.exit(1);
  }

  const registry = loadRegistry();
  const entry = registry[name];
  if (!entry || entry.type !== "scheduled") {
    console.error(`Error: scheduled agent "${name}" not found`);
    process.exit(1);
  }

  // To trigger from CLI, we set nextRunAt to now so the daemon picks it up
  (entry as ScheduledEntry).nextRunAt = new Date().toISOString();
  (entry as ScheduledEntry).paused = false;
  saveRegistry(registry);
  console.log(`Queued "${name}" for immediate execution. The daemon will pick it up within ~30 seconds.`);
}

function deleteSchedule(name: string | undefined): void {
  if (!name) {
    console.error("Error: agent name required");
    process.exit(1);
  }

  const registry = loadRegistry();
  const entry = registry[name];
  if (!entry || entry.type !== "scheduled") {
    console.error(`Error: scheduled agent "${name}" not found`);
    process.exit(1);
  }

  (entry as ScheduledEntry).status = "destroyed";
  (entry as ScheduledEntry).paused = true;
  saveRegistry(registry);
  console.log(`Destroyed "${name}". State directory preserved at ${(entry as ScheduledEntry).stateDir}.`);
}
