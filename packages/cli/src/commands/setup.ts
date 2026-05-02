import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { defineCommand } from "citty";
import * as clack from "@clack/prompts";
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
import { BANNER, dim, bold, green, yellow } from "../branding.js";

export const setupCommandCitty = defineCommand({
  meta: {
    name: "setup",
    description:
      "Bootstrap a new Friday installation. Creates ~/.friday/, prompts for Slack tokens and orchestrator channel, writes config.json and .env, initializes the beads database, and runs doctor. Safe to re-run.",
  },
  args: {
    yes: {
      type: "boolean",
      alias: "y",
      description: "Accept defaults without prompting (for scripted installs)",
      default: false,
    },
  },
  subCommands: {
    linear: defineCommand({
      meta: {
        name: "linear",
        description:
          "Configure Linear integration (write LINEAR_API_KEY to ~/.friday/.env). Prompts for a personal API key, validates it against Linear's GraphQL viewer endpoint, and writes only that env var without touching other setup state.",
      },
      async run() {
        await linearSetupCommand();
      },
    }),
  },
  async run({ args }) {
    const argv: string[] = [];
    if (args.yes) argv.push("--yes");
    await setupCommand(argv);
  },
});

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

function unwrap<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value as T;
}

/** Ask for a value via clack. Shows current value as default (Enter to keep). */
async function ask(
  label: string,
  current: string | undefined,
  opts: { secret?: boolean; required?: boolean } = {},
): Promise<string> {
  const { secret = false, required = false } = opts;
  const placeholder = current ? preview(current, secret) : undefined;

  const validate = required
    ? (v: string | undefined) =>
        (v ?? "").trim().length === 0 && !current ? "Required — please enter a value" : undefined
    : undefined;

  const ask$ = secret && !current ? clack.password : clack.text;
  const value = unwrap(
    await ask$({
      message: label,
      placeholder,
      defaultValue: current,
      validate,
    }),
  );
  const trimmed = (typeof value === "string" ? value : "").trim();
  return trimmed.length === 0 && current ? current : trimmed;
}

/** Ask yes/no via clack. */
async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const value = unwrap(
    await clack.confirm({ message: question, initialValue: defaultYes }),
  );
  return value === true;
}

/**
 * Ping Linear's GraphQL viewer endpoint to confirm a personal API key works.
 * Linear personal API keys are passed as the raw value of the Authorization
 * header (no `Bearer` prefix).
 */
async function validateLinearKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: key,
      },
      body: JSON.stringify({ query: "{ viewer { id } }" }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: { viewer?: { id?: string } }; errors?: unknown };
    return Boolean(json.data?.viewer?.id) && !json.errors;
  } catch {
    return false;
  }
}

/**
 * Read existing .env, replace or insert a single key, write back.
 * Preserves order, comments, and surrounding lines.
 */
function upsertEnvVar(name: string, value: string): void {
  const existingLines = existsSync(ENV_PATH)
    ? readFileSync(ENV_PATH, "utf-8").split("\n")
    : [];
  const filtered = existingLines.filter((l) => l.trim() && !l.startsWith(`${name}=`));
  writeFileSync(ENV_PATH, [`${name}=${value}`, ...filtered].join("\n") + "\n", "utf-8");
}

// ── Main ────────────────────────────────────────────────────────────────

export async function setupCommand(args: string[]): Promise<void> {
  const nonInteractive =
    args.includes("--yes") || args.includes("-y") || !process.stdin.isTTY;

  console.log(BANNER);
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
    if (slackAppToken) {
      const keep = await confirm(`SLACK_APP_TOKEN is set (${maskSecret(slackAppToken)}) — keep?`);
      if (!keep) {
        slackAppToken = await ask("New SLACK_APP_TOKEN (xapp-...)", undefined, { required: true });
      }
    } else {
      slackAppToken = await ask("SLACK_APP_TOKEN (xapp-...)", undefined, { secret: true, required: true });
    }

    if (slackBotToken) {
      const keep = await confirm(`SLACK_BOT_TOKEN is set (${maskSecret(slackBotToken)}) — keep?`);
      if (!keep) {
        slackBotToken = await ask("New SLACK_BOT_TOKEN (xoxb-...)", undefined, { required: true });
      }
    } else {
      slackBotToken = await ask("SLACK_BOT_TOKEN (xoxb-...)", undefined, { secret: true, required: true });
    }
  }

  // ── Linear (optional) ───────────────────────────────────────────────
  console.log();
  console.log(`  ${dim("──")} ${dim("Linear (optional)")} ${dim("─".repeat(30))}`);

  let linearKey = existingEnv.LINEAR_API_KEY ?? "";
  if (nonInteractive) {
    if (linearKey) console.log(`     ${OK} LINEAR_API_KEY  ${dim(maskSecret(linearKey))}`);
    else console.log(`     ${dim("○")} LINEAR_API_KEY  not set (Linear features disabled)`);
  } else {
    linearKey = await promptForLinearKey(linearKey);
  }

  // Write .env (preserve any extra vars the user may have added)
  const existingLines = existsSync(ENV_PATH)
    ? readFileSync(ENV_PATH, "utf-8").split("\n")
    : [];
  const preserved = existingLines.filter(
    (l) =>
      l.trim() &&
      !l.startsWith("SLACK_APP_TOKEN=") &&
      !l.startsWith("SLACK_BOT_TOKEN=") &&
      !l.startsWith("LINEAR_API_KEY="),
  );
  const envLines = [`SLACK_APP_TOKEN=${slackAppToken}`, `SLACK_BOT_TOKEN=${slackBotToken}`];
  if (linearKey) envLines.push(`LINEAR_API_KEY=${linearKey}`);
  envLines.push(...preserved);
  writeFileSync(ENV_PATH, envLines.join("\n") + "\n", "utf-8");

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
    if (channelId) {
      const keep = await confirm(`Orchestrator channel is ${channelId} — keep?`);
      if (!keep) {
        channelId = await ask("New orchestrator channel ID", undefined, { required: true });
      }
    } else {
      channelId = await ask("Orchestrator channel ID", undefined, { required: true });
    }

    // Working directory
    const wd = baseConfig.agent.workingDirectory;
    const keepWd = await confirm(`Working directory is ${wd} — keep?`);
    let newWd = wd;
    if (!keepWd) {
      newWd = await ask("New working directory", wd);
      mkdirSync(newWd, { recursive: true });
    }

    // Model
    const model = baseConfig.agent.model;
    const keepModel = await confirm(`Agent model is ${model} — keep?`);
    let newModel = model;
    if (!keepModel) {
      newModel = await ask("New model", model);
    }

    baseConfig.agent.workingDirectory = newWd;
    baseConfig.agent.model = newModel;
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

/**
 * Interactive prompt for the Linear personal API key. Returns the key (or
 * empty string if user opts out). Validates against Linear's GraphQL viewer
 * endpoint when a new key is provided.
 */
async function promptForLinearKey(current: string): Promise<string> {
  if (current) {
    const keep = await confirm(`LINEAR_API_KEY is set (${maskSecret(current)}) — keep?`);
    if (keep) return current;
    const replacement = await ask("New LINEAR_API_KEY", undefined, { secret: true });
    if (!replacement) return current;
    const ok = await validateLinearKey(replacement);
    if (!ok) console.log(`     ${WARN} Key validation failed — saved anyway, fix later`);
    else console.log(`     ${OK} Validated against Linear GraphQL viewer`);
    return replacement;
  }
  const wantLinear = await confirm("Configure Linear integration?", false);
  if (!wantLinear) return "";
  console.log(dim("     Generate a personal API key at: https://linear.app/settings/api"));
  const key = await ask("LINEAR_API_KEY", undefined, { secret: true, required: true });
  const ok = await validateLinearKey(key);
  if (!ok) console.log(`     ${WARN} Key validation failed — saved anyway, fix later`);
  else console.log(`     ${OK} Validated against Linear GraphQL viewer`);
  return key;
}

/**
 * `friday setup linear` — re-run only the Linear section without touching the
 * rest of the install. Convenient for rotating keys or enabling Linear after
 * an initial Linear-less install.
 */
export async function linearSetupCommand(): Promise<void> {
  console.log(BANNER);
  console.log(`  ${bold("Friday Setup — Linear")}`);
  console.log();
  if (!process.stdin.isTTY) {
    console.log(`  ${WARN} Non-interactive shell; aborting (run interactively to set the key)`);
    process.exit(1);
  }
  const existingEnv = parseEnvFile(ENV_PATH);
  const current = existingEnv.LINEAR_API_KEY ?? "";
  const newKey = await promptForLinearKey(current);
  if (newKey) {
    upsertEnvVar("LINEAR_API_KEY", newKey);
    console.log(`     ${OK} ${ENV_PATH}`);
  } else {
    console.log(`     ${dim("○")} No key set — Linear features remain disabled`);
  }
}
