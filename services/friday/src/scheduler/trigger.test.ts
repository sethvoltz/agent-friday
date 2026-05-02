import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test buildFirstTurnWithState indirectly through the module's behavior.
// For the trigger itself, we mock the query() call and check state management.

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(async function* () {
    yield {
      type: "result",
      subtype: "success",
      session_id: "test-session-123",
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.001,
      duration_ms: 500,
    };
  }),
}));

vi.mock("../sessions/registry.js", () => ({
  updateAgentSession: vi.fn(),
  updateAgentStatus: vi.fn(),
  updateScheduledAgent: vi.fn(),
  getAgent: vi.fn(),
}));

vi.mock("../comms/mail-tools.js", () => ({
  createMailTools: vi.fn(() => ({})),
}));

vi.mock("../monitor/usage.js", () => ({
  logUsage: vi.fn(),
}));

vi.mock("../log.js", () => ({
  log: vi.fn(),
}));

vi.mock("../events/bus.js", () => ({
  eventBus: { publish: vi.fn() },
}));

vi.mock("../agent/prime.js", () => ({
  buildAgentSystemPrompt: vi.fn(() => "system prompt"),
}));

import { triggerScheduledAgent } from "./trigger.js";
import { updateAgentStatus, updateScheduledAgent, getAgent } from "../sessions/registry.js";
import { eventBus } from "../events/bus.js";
import type { ScheduledEntry } from "@friday/shared";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getAgent returns a live (non-destroyed) entry so post-run status
  // reset proceeds. Individual tests can override.
  vi.mocked(getAgent).mockImplementation((name: string) => ({
    type: "scheduled",
    sessionId: null,
    status: "active",
    createdAt: "2026-04-25T00:00:00Z",
    schedule: { cron: "*/5 * * * *" },
    taskPrompt: "",
    cwd: "/tmp",
    stateDir: "/tmp",
    lastRunAt: null,
    nextRunAt: null,
    paused: false,
  }));
});

function makeEntry(overrides: Partial<ScheduledEntry> = {}): ScheduledEntry {
  const stateDir = join(tmpdir(), `friday-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(stateDir, { recursive: true });

  return {
    type: "scheduled",
    sessionId: null,
    status: "idle",
    createdAt: "2026-04-25T00:00:00Z",
    schedule: { cron: "*/5 * * * *" },
    taskPrompt: "Check the API for new data",
    cwd: "/tmp",
    stateDir,
    lastRunAt: null,
    nextRunAt: "2026-04-25T10:05:00Z",
    paused: false,
    ...overrides,
  };
}

describe("triggerScheduledAgent", () => {
  it("marks agent as active immediately", () => {
    const entry = makeEntry();
    triggerScheduledAgent("scheduled-test", entry, "claude-sonnet-4-6");

    expect(updateAgentStatus).toHaveBeenCalledWith("scheduled-test", "active");
  });

  it("publishes schedule:triggered event", () => {
    const entry = makeEntry();
    triggerScheduledAgent("scheduled-test", entry, "claude-sonnet-4-6");

    expect(eventBus.publish).toHaveBeenCalledWith({
      type: "schedule:triggered",
      agentName: "scheduled-test",
    });
  });

  it("writes last-run.md after completion", async () => {
    const entry = makeEntry();
    triggerScheduledAgent("scheduled-test", entry, "claude-sonnet-4-6");

    // Wait for the async run to complete
    await vi.waitFor(() => {
      const lastRunPath = join(entry.stateDir, "last-run.md");
      expect(existsSync(lastRunPath)).toBe(true);
    });

    const lastRun = readFileSync(join(entry.stateDir, "last-run.md"), "utf-8");
    expect(lastRun).toContain("completed");
    expect(lastRun).toContain("test-session-123");
  });

  it("marks agent idle after completion", async () => {
    const entry = makeEntry();
    triggerScheduledAgent("scheduled-test", entry, "claude-sonnet-4-6");

    await vi.waitFor(() => {
      expect(updateAgentStatus).toHaveBeenCalledWith("scheduled-test", "idle");
    });
  });

  it("archives previous sessionId to formerSessionIds", async () => {
    const entry = makeEntry({ sessionId: "old-session-456" });
    triggerScheduledAgent("scheduled-test", entry, "claude-sonnet-4-6");

    await vi.waitFor(() => {
      expect(updateScheduledAgent).toHaveBeenCalledWith("scheduled-test", expect.objectContaining({
        formerSessionIds: ["old-session-456"],
      }));
    });
  });

  it("injects state.md contents into first-turn prompt when available", async () => {
    const entry = makeEntry();
    writeFileSync(join(entry.stateDir, "state.md"), "Processed pages 1-47. Resume at page 48.");

    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    triggerScheduledAgent("scheduled-test", entry, "claude-sonnet-4-6");

    await vi.waitFor(() => {
      expect(query).toHaveBeenCalled();
    });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.prompt).toContain("State from your previous run");
    expect(callArgs.prompt).toContain("Processed pages 1-47");
  });
});
