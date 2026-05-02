import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The DB layer reads HOME at module-load time when computing FRIDAY_DB_PATH.
// Override before importing anything from @friday/shared.
const tmpHome = mkdtempSync(join(tmpdir(), "friday-usage-test-"));
process.env.HOME = tmpHome;

const { logUsage, migrateUsageLog } = await import("./usage.js");
const { getRawDb, closeDb, USAGE_LOG_PATH } = await import("@friday/shared");

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-04-22T12:00:00Z",
    channelId: "C123",
    sessionType: "orchestrator" as const,
    sessionId: "sess-1",
    costUsd: 0.05,
    inputTokens: 100,
    outputTokens: 200,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    turnNumber: 1,
    durationMs: 1500,
    ...overrides,
  };
}

afterAll(() => {
  closeDb();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("logUsage", () => {
  beforeEach(() => {
    getRawDb().exec("DELETE FROM usage");
  });

  it("inserts a row into the usage table", () => {
    logUsage(makeEntry());

    const rows = getRawDb()
      .prepare("SELECT channel_id AS channelId, input_tokens AS inputTokens FROM usage")
      .all() as Array<{ channelId: string; inputTokens: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].channelId).toBe("C123");
    expect(rows[0].inputTokens).toBe(100);
  });

  it("inserts multiple rows", () => {
    logUsage(makeEntry({ sessionId: "sess-1" }));
    logUsage(makeEntry({ sessionId: "sess-2" }));

    const rows = getRawDb()
      .prepare("SELECT session_id AS sessionId FROM usage ORDER BY id")
      .all() as Array<{ sessionId: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].sessionId).toBe("sess-1");
    expect(rows[1].sessionId).toBe("sess-2");
  });

  it("preserves nullable fields", () => {
    logUsage(makeEntry({ costUsd: null, turnNumber: 3 }));

    const row = getRawDb()
      .prepare(
        "SELECT cost_usd AS costUsd, turn_number AS turnNumber, session_type AS sessionType, duration_ms AS durationMs FROM usage",
      )
      .get() as {
      costUsd: number | null;
      turnNumber: number;
      sessionType: string;
      durationMs: number;
    };
    expect(row.costUsd).toBeNull();
    expect(row.turnNumber).toBe(3);
    expect(row.sessionType).toBe("orchestrator");
    expect(row.durationMs).toBe(1500);
  });

  it("stores provided agentName", () => {
    logUsage(makeEntry({ sessionId: "sess-x" }), "research-bot");

    const row = getRawDb()
      .prepare("SELECT agent_name AS agentName FROM usage WHERE session_id = ?")
      .get("sess-x") as { agentName: string | null };
    expect(row.agentName).toBe("research-bot");
  });
});

describe("migrateUsageLog", () => {
  beforeEach(() => {
    getRawDb().exec("DELETE FROM usage");
  });

  it("imports a JSONL file then renames it", async () => {
    const lines = [
      makeEntry({ sessionId: "sess-a" }),
      makeEntry({ sessionId: "sess-b" }),
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");
    writeFileSync(USAGE_LOG_PATH, lines + "\n");

    await migrateUsageLog();

    const count = getRawDb()
      .prepare("SELECT COUNT(*) AS n FROM usage")
      .get() as { n: number };
    expect(count.n).toBe(2);
    expect(existsSync(USAGE_LOG_PATH)).toBe(false);
  });

  it("skips when usage table is non-empty", async () => {
    logUsage(makeEntry({ sessionId: "already-here" }));
    writeFileSync(USAGE_LOG_PATH, JSON.stringify(makeEntry({ sessionId: "extra" })) + "\n");

    await migrateUsageLog();

    const count = getRawDb()
      .prepare("SELECT COUNT(*) AS n FROM usage")
      .get() as { n: number };
    expect(count.n).toBe(1);
    expect(existsSync(USAGE_LOG_PATH)).toBe(true);
  });
});
