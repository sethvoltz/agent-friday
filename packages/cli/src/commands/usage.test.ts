import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Override HOME so the SQLite DB lives in an isolated temp dir.
const tmpHome = mkdtempSync(join(tmpdir(), "friday-cli-usage-test-"));
process.env.HOME = tmpHome;

const { usageCommand } = await import("./usage.js");
const { getRawDb, insertUsage, closeDb } = await import("@friday/shared");

function makeEntry(overrides: Record<string, any> = {}) {
  return {
    timestamp: new Date().toISOString(),
    channelId: "C123",
    sessionType: "orchestrator" as const,
    sessionId: "sess-1",
    agentName: "orchestrator",
    model: "claude-sonnet-4-6",
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 200,
    cacheReadTokens: 800,
    turnNumber: 1,
    durationMs: 3000,
    ...overrides,
  };
}

afterAll(() => {
  closeDb();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("usageCommand", () => {
  beforeEach(() => {
    getRawDb().exec("DELETE FROM usage");
  });

  it("prints 'no activity' message when usage table is empty", () => {
    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    usageCommand([]);
    expect(logs.join("\n")).toContain("No usage data recorded yet.");

    mockLog.mockRestore();
  });

  it("prints report for valid usage data", () => {
    insertUsage(makeEntry({ costUsd: 0.01, sessionId: "s1" }));
    insertUsage(makeEntry({ costUsd: 0.02, sessionId: "s1", turnNumber: 2 }));

    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    usageCommand([]);

    const output = logs.join("\n");
    expect(output).toContain("Friday Usage Report");
    expect(output).toContain("$0.0300");
    expect(output).toContain("2 turns");
    expect(output).toContain("Cache hit rate:");
    expect(output).toContain("Orchestrator:");

    mockLog.mockRestore();
  });

  it("shows token breakdown in verbose mode", () => {
    insertUsage(makeEntry());

    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    usageCommand(["-v"]);

    const output = logs.join("\n");
    expect(output).toContain("Token breakdown");
    expect(output).toContain("Input:");
    expect(output).toContain("Cache read:");

    mockLog.mockRestore();
  });

  it("separates today vs this week vs all time", () => {
    const now = new Date();
    insertUsage(makeEntry({ costUsd: 0.05, timestamp: now.toISOString() }));

    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    insertUsage(makeEntry({ costUsd: 0.10, timestamp: threeDaysAgo.toISOString() }));

    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    insertUsage(makeEntry({ costUsd: 0.20, timestamp: monthAgo.toISOString() }));

    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    usageCommand([]);
    const output = logs.join("\n");

    expect(output).toMatch(/Today\s+.*\$0\.0500.*1 turns/);
    expect(output).toMatch(/This week.*\$0\.1500.*2 turns/);
    expect(output).toMatch(/All time.*\$0\.3500.*3 turns/);

    mockLog.mockRestore();
  });

  it("prints 'no activity' for today when all entries are old", () => {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    insertUsage(makeEntry({ timestamp: monthAgo.toISOString() }));

    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    usageCommand([]);
    const output = logs.join("\n");
    expect(output).toMatch(/Today\s+: no activity/);

    mockLog.mockRestore();
  });
});
