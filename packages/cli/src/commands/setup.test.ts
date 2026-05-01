import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `friday-setup-test-${process.pid}-${Date.now()}`);
const fridayDir = join(testDir, ".friday");
const configPath = join(fridayDir, "config.json");
const envPath = join(fridayDir, ".env");
const sessionsDir = join(fridayDir, "sessions");
const beadsDir = join(fridayDir, "beads");
const workingDir = join(fridayDir, "working");

vi.mock("@friday/shared", async () => {
  const actual = await vi.importActual<typeof import("@friday/shared")>("@friday/shared");
  const fs = await import("node:fs");
  const defaultConfig = {
    slack: { orchestratorChannelId: "" },
    agent: {
      workingDirectory: workingDir,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
      permissionMode: "auto-accept",
      model: "claude-sonnet-4-6",
    },
    slack_formatting: {
      maxMessageLength: 4000,
      streamingEnabled: true,
      thinkingIndicatorDelaySec: 30,
      emojiReactions: { processing: "eyes", queued: "clock1", error: "x", complete: null },
    },
    monitoring: { usageLogFile: join(fridayDir, "usage.jsonl"), warnAtPercentOfDailyLimit: 80 },
    eventServer: { port: 7444 },
  };
  return {
    ...actual,
    FRIDAY_DIR: fridayDir,
    CONFIG_PATH: configPath,
    ENV_PATH: envPath,
    SESSIONS_DIR: sessionsDir,
    BEADS_DIR: beadsDir,
    loadConfig: () => {
      if (fs.existsSync(configPath)) {
        const userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        return {
          ...defaultConfig,
          ...userConfig,
          slack: { ...defaultConfig.slack, ...userConfig.slack },
          agent: { ...defaultConfig.agent, ...userConfig.agent },
        };
      }
      return defaultConfig;
    },
  };
});

vi.mock("../services.js", () => ({
  SERVICES: {
    daemon: { label: "Friday daemon", package: "@friday/daemon", script: "start" },
    dashboard: { label: "Dashboard", package: "@friday/dashboard", script: "preview" },
  },
  readPid: vi.fn().mockReturnValue(null),
  isRunning: vi.fn().mockReturnValue(false),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.startsWith("bd init")) return "";
    if (cmd.startsWith("which claude")) return "/usr/local/bin/claude";
    if (cmd.startsWith("which")) throw new Error("not found");
    if (cmd === "node --version") return "v22.0.0";
    if (cmd === "pnpm --version") return "10.0.0";
    if (cmd === "claude --version") return "2.1.118 (Claude Code)";
    if (cmd.startsWith("brew outdated")) return '{"formulae":[],"casks":[]}';
    if (cmd.startsWith("curl")) throw new Error("connection refused");
    return "";
  }),
}));

const { setupCommand } = await import("./setup.js");

describe("friday setup", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates directory structure in --yes mode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupCommand(["--yes"]);
    logSpy.mockRestore();

    expect(existsSync(fridayDir)).toBe(true);
    expect(existsSync(sessionsDir)).toBe(true);
    expect(existsSync(workingDir)).toBe(true);
    expect(existsSync(beadsDir)).toBe(true);
  });

  it("writes config.json with defaults in --yes mode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupCommand(["--yes"]);
    logSpy.mockRestore();

    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.slack).toBeDefined();
    expect(config.agent).toBeDefined();
  });

  it("writes .env file in --yes mode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupCommand(["--yes"]);
    logSpy.mockRestore();

    expect(existsSync(envPath)).toBe(true);
    const env = readFileSync(envPath, "utf-8");
    expect(env).toContain("SLACK_APP_TOKEN=");
    expect(env).toContain("SLACK_BOT_TOKEN=");
  });

  it("preserves existing config values in --yes mode", async () => {
    mkdirSync(fridayDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        slack: { orchestratorChannelId: "C99999" },
        agent: { model: "claude-opus-4-6" },
      }),
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupCommand(["--yes"]);
    logSpy.mockRestore();

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.slack.orchestratorChannelId).toBe("C99999");
  });

  it("preserves existing .env tokens in --yes mode", async () => {
    mkdirSync(fridayDir, { recursive: true });
    writeFileSync(envPath, "SLACK_APP_TOKEN=xapp-existing\nSLACK_BOT_TOKEN=xoxb-existing\n");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupCommand(["--yes"]);
    logSpy.mockRestore();

    const env = readFileSync(envPath, "utf-8");
    expect(env).toContain("SLACK_APP_TOKEN=xapp-existing");
    expect(env).toContain("SLACK_BOT_TOKEN=xoxb-existing");
  });

  it("preserves extra .env vars on re-run", async () => {
    mkdirSync(fridayDir, { recursive: true });
    writeFileSync(
      envPath,
      "SLACK_APP_TOKEN=xapp-test\nSLACK_BOT_TOKEN=xoxb-test\nCUSTOM_VAR=keep-me\n",
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupCommand(["--yes"]);
    logSpy.mockRestore();

    const env = readFileSync(envPath, "utf-8");
    expect(env).toContain("CUSTOM_VAR=keep-me");
    expect(env).toContain("SLACK_APP_TOKEN=xapp-test");
  });

  it("runs doctor at the end", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));
    await setupCommand(["--yes"]);
    logSpy.mockRestore();

    const output = logs.join("\n");
    expect(output).toContain("Friday Doctor");
  });
});
