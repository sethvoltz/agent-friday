import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FRIDAY_DIR, AGENTS_PATH, SESSIONS_DIR } from "@friday/shared";
import {
  type ServiceName,
  SERVICES,
  readPid,
  isRunning,
  removePid,
  parseServiceArg,
  findMonorepoRoot,
} from "../services.js";

const DEV_SCRIPTS: Record<ServiceName, string> = {
  daemon: "dev",
  dashboard: "dev",
};

function startDevService(service: ServiceName, root: string): void {
  const info = SERVICES[service];
  const existing = readPid(service);

  if (existing && isRunning(existing)) {
    console.log(`  ${info.label} is already running (PID ${existing})`);
    return;
  }

  console.log(`  Starting ${info.label} in dev mode...`);
  spawn("pnpm", ["--filter", info.package, "run", DEV_SCRIPTS[service]], {
    cwd: root,
    stdio: "inherit",
  });
}

function startDevAll(root: string): void {
  // Use turbo dev to start everything with proper orchestration
  console.log("  Starting all services in dev mode via turbo...");
  spawn("pnpm", ["run", "dev"], {
    cwd: root,
    stdio: "inherit",
  });
}

function resetOrchestrator(): void {
  // Check daemon isn't running
  const daemonPid = readPid("daemon");
  if (daemonPid && isRunning(daemonPid)) {
    console.error("Daemon is still running. Stop it first: friday stop daemon");
    process.exit(1);
  }

  let changed = false;

  // 1. Clear orchestrator sessionId in agents.json
  if (existsSync(AGENTS_PATH)) {
    const registry = JSON.parse(readFileSync(AGENTS_PATH, "utf-8"));
    if (registry.orchestrator?.sessionId) {
      console.log(`  Clearing orchestrator session: ${registry.orchestrator.sessionId}`);
      registry.orchestrator.sessionId = null;
      writeFileSync(AGENTS_PATH, JSON.stringify(registry, null, 2));
      changed = true;
    }
  }

  // 2. Find and clear the orchestrator channel mapping from channels.json
  const channelsFile = join(SESSIONS_DIR, "channels.json");
  if (existsSync(channelsFile)) {
    const channels: Record<string, string> = JSON.parse(
      readFileSync(channelsFile, "utf-8")
    );

    // Load config to find orchestrator channel ID
    const configPath = join(FRIDAY_DIR, "config.json");
    let orchChannelId: string | null = null;
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      orchChannelId = config.slack?.orchestratorChannelId ?? null;
    }

    if (orchChannelId && channels[orchChannelId]) {
      console.log(`  Clearing channel session for ${orchChannelId}`);
      delete channels[orchChannelId];
      writeFileSync(channelsFile, JSON.stringify(channels, null, 2));
      changed = true;
    }
  }

  if (changed) {
    console.log("\n  Orchestrator session reset. Start the daemon to begin a fresh session.");
  } else {
    console.log("  No orchestrator session to reset.");
  }
}

export function devCommand(args: string[]): void {
  const subcommand = args[0];

  if (!subcommand) {
    console.error("Usage: friday dev <start|restart> [service]");
    process.exit(1);
  }

  const root = findMonorepoRoot();
  if (!root) {
    console.error("Could not find agent-friday monorepo root.");
    console.error("Dev commands must be run from within the monorepo.");
    process.exit(1);
  }

  if (subcommand === "start") {
    const target = parseServiceArg(args[1]);
    if (target === "all") {
      startDevAll(root);
    } else {
      startDevService(target, root);
    }
    return;
  }

  if (subcommand === "restart") {
    const serviceName = args[1];
    if (!serviceName) {
      console.error("Usage: friday dev restart <service>");
      console.error("A service name is required: daemon or dashboard");
      process.exit(1);
    }

    if (serviceName !== "daemon" && serviceName !== "dashboard") {
      console.error(`Unknown service: ${serviceName}`);
      process.exit(1);
    }

    const service: ServiceName = serviceName;
    const info = SERVICES[service];

    // Kill existing
    const pid = readPid(service);
    if (pid && isRunning(pid)) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`  ${info.label} stopped (PID ${pid})`);
      } catch {
        // already gone
      }
      removePid(service);
    }

    // Restart in dev mode
    startDevService(service, root);
    return;
  }

  if (subcommand === "reset-orchestrator") {
    resetOrchestrator();
    return;
  }

  console.error(`Unknown dev command: ${subcommand}`);
  console.error("Valid commands: start, restart, reset-orchestrator");
  process.exit(1);
}
