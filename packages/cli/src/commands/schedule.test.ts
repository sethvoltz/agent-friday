import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Create a temp dir for the fake registry
let tempDir: string;
let agentsPath: string;
let schedulesDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "friday-sched-test-"));
  agentsPath = join(tempDir, "agents.json");
  schedulesDir = join(tempDir, "schedules");
});

// Mock @friday/shared to use temp paths
vi.mock("@friday/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@friday/shared")>();
  return {
    ...original,
    get AGENTS_PATH() { return agentsPath; },
    get SCHEDULES_DIR() { return schedulesDir; },
    get FRIDAY_DIR() { return tempDir; },
  };
});

const { scheduleCommand } = await import("./schedule.js");

describe("scheduleCommand", () => {
  it("lists empty schedules", () => {
    writeFileSync(agentsPath, "{}");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    scheduleCommand(["list"]);

    expect(logs.join("\n")).toContain("No scheduled agents");
    vi.restoreAllMocks();
  });

  it("creates a scheduled agent", () => {
    writeFileSync(agentsPath, "{}");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    scheduleCommand([
      "create",
      "--name", "test-cron",
      "--cron", "0 */6 * * *",
      "--task", "Check API for new data",
    ]);

    expect(logs.join("\n")).toContain('Created scheduled agent "scheduled-test-cron"');

    const registry = JSON.parse(readFileSync(agentsPath, "utf-8"));
    expect(registry["scheduled-test-cron"]).toBeDefined();
    expect(registry["scheduled-test-cron"].type).toBe("scheduled");
    expect(registry["scheduled-test-cron"].schedule.cron).toBe("0 */6 * * *");
    expect(registry["scheduled-test-cron"].taskPrompt).toBe("Check API for new data");
    vi.restoreAllMocks();
  });

  it("pauses a scheduled agent", () => {
    writeFileSync(agentsPath, JSON.stringify({
      "scheduled-test": {
        type: "scheduled",
        sessionId: null,
        status: "idle",
        createdAt: "2026-04-25T00:00:00Z",
        schedule: { cron: "* * * * *" },
        taskPrompt: "test",
        cwd: "/tmp",
        stateDir: join(schedulesDir, "scheduled-test"),
        lastRunAt: null,
        nextRunAt: null,
        paused: false,
      },
    }));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    scheduleCommand(["pause", "scheduled-test"]);

    const registry = JSON.parse(readFileSync(agentsPath, "utf-8"));
    expect(registry["scheduled-test"].paused).toBe(true);
    expect(logs.join("\n")).toContain("Paused");
    vi.restoreAllMocks();
  });

  it("deletes a scheduled agent (soft delete)", () => {
    writeFileSync(agentsPath, JSON.stringify({
      "scheduled-test": {
        type: "scheduled",
        sessionId: null,
        status: "idle",
        createdAt: "2026-04-25T00:00:00Z",
        schedule: { cron: "* * * * *" },
        taskPrompt: "test",
        cwd: "/tmp",
        stateDir: join(schedulesDir, "scheduled-test"),
        lastRunAt: null,
        nextRunAt: null,
        paused: false,
      },
    }));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    scheduleCommand(["delete", "scheduled-test"]);

    const registry = JSON.parse(readFileSync(agentsPath, "utf-8"));
    expect(registry["scheduled-test"].status).toBe("destroyed");
    expect(registry["scheduled-test"].paused).toBe(true);
    vi.restoreAllMocks();
  });

  it("triggers a scheduled agent by setting nextRunAt to now", () => {
    writeFileSync(agentsPath, JSON.stringify({
      "scheduled-test": {
        type: "scheduled",
        sessionId: null,
        status: "idle",
        createdAt: "2026-04-25T00:00:00Z",
        schedule: { cron: "0 12 * * *" },
        taskPrompt: "test",
        cwd: "/tmp",
        stateDir: join(schedulesDir, "scheduled-test"),
        lastRunAt: null,
        nextRunAt: "2026-04-26T12:00:00Z",
        paused: false,
      },
    }));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    scheduleCommand(["trigger", "scheduled-test"]);

    const registry = JSON.parse(readFileSync(agentsPath, "utf-8"));
    const nextRun = new Date(registry["scheduled-test"].nextRunAt);
    // Should be roughly "now", not the original future time
    expect(nextRun.getTime()).toBeLessThanOrEqual(Date.now() + 5000);
    expect(logs.join("\n")).toContain("Queued");
    vi.restoreAllMocks();
  });

  it("requires --name for create", () => {
    writeFileSync(agentsPath, "{}");
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => scheduleCommand(["create", "--cron", "* * * * *", "--task", "test"])).toThrow("process.exit");

    mockExit.mockRestore();
    vi.restoreAllMocks();
  });
});
