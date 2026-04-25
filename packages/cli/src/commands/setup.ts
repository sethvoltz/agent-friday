import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import {
  FRIDAY_DIR,
  CONFIG_PATH,
  ENV_PATH,
  SESSIONS_DIR,
  BEADS_DIR,
  loadConfig,
  type FridayConfig,
} from "@friday/shared";
import { runChecks, printResults } from "./doctor.js";

// ── ANSI helpers ────────────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;

const OK = green("\u2713");
const WARN = yellow("\u26A0");

// ── Helpers ─────────────────────────────────────────────────────────────

function maskSecret(value: string): string {
  if (value.length <= 8) return "***";
  return value.slice(0, 8) + "\u2026";
}

function preview(value: string, secret: boolean): string {
  return secret ? maskSecret(value) : value;
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

/** Ask user for a value. Shows current value as default (enter to keep). */
async function ask(
  rl: Interface,
  label: string,
  current: string | undefined,
  opts: { secret?: boolean; required?: boolean } = {},
): Promise<string> {
  const { secret = false, required = false } = opts;

  if (current) {
    const shown = preview(current, secret);
    return new Promise((resolve) => {
      rl.question(`     ${label} ${dim(`[${shown}]`)}: `, (answer) => {
        resolve(answer.trim() || current);
      });
    });
  }

  // No existing value — prompt until we get one if required
  return new Promise((resolve) => {
    const doAsk = () => {
      rl.question(`     ${label}: `, (answer) => {
        const val = answer.trim();
        if (!val && required) {
          console.log(`     ${yellow("Required")} — please enter a value`);
          doAsk();
        } else {
          resolve(val);
        }
      });
    };
    doAsk();
  });
}

/** Ask yes/no. Returns true for yes. */
async function confirm(rl: Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`     ${question} ${dim(`[${hint}]`)}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === "y" || a === "yes");
    });
  });
}

// ── Main ────────────────────────────────────────────────────────────────

export async function setupCommand(args: string[]): Promise<void> {
  const nonInteractive = args.includes("--yes") || args.includes("-y");

  console.log();
  console.log(`  ${bold("Friday Setup")}`);

  const hasExisting = existsSync(CONFIG_PATH);

  // ── Directories ─────────────────────────────────────────────────────
  console.log();
  console.log(`  ${dim("\u2500\u2500")} ${dim("Directories")} ${dim("\u2500".repeat(36))}`);

  const config = hasExisting ? loadConfig() : null;
  const workingDir = config?.agent.workingDirectory ?? `${FRIDAY_DIR}/working`;

  for (const dir of [FRIDAY_DIR, SESSIONS_DIR, workingDir, BEADS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
  console.log(`     ${OK} ${FRIDAY_DIR}`);
  console.log(`     ${OK} ${SESSIONS_DIR}`);
  console.log(`     ${OK} ${workingDir}`);
  console.log(`     ${OK} ${BEADS_DIR}`);

  // ── Slack tokens ────────────────────────────────────────────────────
  console.log();
  console.log(`  ${dim("\u2500\u2500")} ${dim("Slack tokens")} ${dim("\u2500".repeat(35))}`);

  const existingEnv = parseEnvFile(ENV_PATH);
  let slackAppToken = existingEnv.SLACK_APP_TOKEN ?? "";
  let slackBotToken = existingEnv.SLACK_BOT_TOKEN ?? "";

  if (nonInteractive) {
    if (slackAppToken) console.log(`     ${OK} SLACK_APP_TOKEN  ${dim(maskSecret(slackAppToken))}`);
    else console.log(`     ${WARN} SLACK_APP_TOKEN  not set`);
    if (slackBotToken) console.log(`     ${OK} SLACK_BOT_TOKEN  ${dim(maskSecret(slackBotToken))}`);
    else console.log(`     ${WARN} SLACK_BOT_TOKEN  not set`);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    if (slackAppToken) {
      const keep = await confirm(rl, `SLACK_APP_TOKEN is set ${dim(`(${maskSecret(slackAppToken)})`)} — keep?`);
      if (!keep) {
        slackAppToken = await ask(rl, "New SLACK_APP_TOKEN (xapp-...)", undefined, { required: true });
      }
    } else {
      slackAppToken = await ask(rl, "SLACK_APP_TOKEN (xapp-...)", undefined, { secret: true, required: true });
    }

    if (slackBotToken) {
      const keep = await confirm(rl, `SLACK_BOT_TOKEN is set ${dim(`(${maskSecret(slackBotToken)})`)} — keep?`);
      if (!keep) {
        slackBotToken = await ask(rl, "New SLACK_BOT_TOKEN (xoxb-...)", undefined, { required: true });
      }
    } else {
      slackBotToken = await ask(rl, "SLACK_BOT_TOKEN (xoxb-...)", undefined, { secret: true, required: true });
    }

    rl.close();
  }

  // Write .env (preserve any extra vars the user may have added)
  const existingLines = existsSync(ENV_PATH)
    ? readFileSync(ENV_PATH, "utf-8").split("\n")
    : [];
  const preserved = existingLines.filter(
    (l) => l.trim() && !l.startsWith("SLACK_APP_TOKEN=") && !l.startsWith("SLACK_BOT_TOKEN="),
  );
  writeFileSync(
    ENV_PATH,
    [`SLACK_APP_TOKEN=${slackAppToken}`, `SLACK_BOT_TOKEN=${slackBotToken}`, ...preserved].join("\n") + "\n",
    "utf-8",
  );

  // ── Configuration ───────────────────────────────────────────────────
  console.log();
  console.log(`  ${dim("\u2500\u2500")} ${dim("Configuration")} ${dim("\u2500".repeat(34))}`);

  const baseConfig = config ?? loadConfig();

  // orchestratorChannelId — required
  let channelId = baseConfig.slack.orchestratorChannelId;
  if (nonInteractive) {
    if (channelId) console.log(`     ${OK} Orchestrator channel  ${dim(channelId)}`);
    else console.log(`     ${WARN} Orchestrator channel  not set`);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    if (channelId) {
      const keep = await confirm(rl, `Orchestrator channel is ${dim(channelId)} — keep?`);
      if (!keep) {
        channelId = await ask(rl, "New orchestrator channel ID", undefined, { required: true });
      }
    } else {
      channelId = await ask(rl, "Orchestrator channel ID", undefined, { required: true });
    }

    // Working directory
    const wd = baseConfig.agent.workingDirectory;
    const keepWd = await confirm(rl, `Working directory is ${dim(wd)} — keep?`);
    let newWd = wd;
    if (!keepWd) {
      newWd = await ask(rl, "New working directory", wd);
      mkdirSync(newWd, { recursive: true });
    }

    // Model
    const model = baseConfig.agent.model;
    const keepModel = await confirm(rl, `Agent model is ${dim(model)} — keep?`);
    let newModel = model;
    if (!keepModel) {
      newModel = await ask(rl, "New model", model);
    }

    baseConfig.agent.workingDirectory = newWd;
    baseConfig.agent.model = newModel;
    rl.close();
  }

  const mergedConfig: FridayConfig = {
    ...baseConfig,
    slack: {
      ...baseConfig.slack,
      orchestratorChannelId: channelId,
    },
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(mergedConfig, null, 2) + "\n", "utf-8");
  console.log(`     ${OK} ${CONFIG_PATH}`);

  // ── Beads ───────────────────────────────────────────────────────────
  console.log();
  console.log(`  ${dim("\u2500\u2500")} ${dim("Beads")} ${dim("\u2500".repeat(42))}`);

  if (existsSync(`${BEADS_DIR}/.beads`)) {
    console.log(`     ${OK} Already initialized`);
  } else {
    try {
      execSync("bd init --non-interactive --prefix friday --skip-agents --skip-hooks", {
        cwd: BEADS_DIR,
        stdio: "pipe",
      });
      console.log(`     ${OK} Initialized`);
    } catch {
      console.log(`     ${WARN} Could not initialize — is ${dim("bd")} installed?`);
    }
  }

  // ── Doctor ──────────────────────────────────────────────────────────
  const results = await runChecks();
  printResults(results);
}
