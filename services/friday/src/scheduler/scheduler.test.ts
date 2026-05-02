import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeNextRun, checkSchedules } from "./scheduler.js";
import type { ScheduleSpec } from "@friday/shared";

// Mock dependencies
vi.mock("../sessions/registry.js", () => ({
  listAgents: vi.fn(() => []),
  getAgent: vi.fn(),
  updateScheduledAgent: vi.fn(),
}));

vi.mock("./trigger.js", () => ({
  triggerScheduledAgent: vi.fn(),
}));

vi.mock("../log.js", () => ({
  log: vi.fn(),
}));

import { listAgents, updateScheduledAgent } from "../sessions/registry.js";
import { triggerScheduledAgent } from "./trigger.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeNextRun", () => {
  it("returns next occurrence for a cron expression", () => {
    const from = new Date("2026-04-25T10:00:00Z");
    const spec: ScheduleSpec = { cron: "0 12 * * *" }; // daily at 12:00

    const next = computeNextRun(spec, from);

    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });

  it("respects timezone for cron", () => {
    const from = new Date("2026-04-25T10:00:00Z");
    const spec: ScheduleSpec = { cron: "0 9 * * *", timezone: "America/New_York" };

    const next = computeNextRun(spec, from);

    expect(next).not.toBeNull();
  });

  it("returns null for one-shot schedule (runAt)", () => {
    const spec: ScheduleSpec = { runAt: "2026-04-26T09:00:00Z" };

    const next = computeNextRun(spec);

    expect(next).toBeNull();
  });

  it("computes next from a given date", () => {
    const from = new Date("2026-04-25T10:00:00Z");
    const spec: ScheduleSpec = { cron: "*/5 * * * *" }; // every 5 minutes

    const next = computeNextRun(spec, from);

    expect(next).not.toBeNull();
    expect(next!.getMinutes() % 5).toBe(0);
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe("checkSchedules", () => {
  it("triggers agents that are due", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();

    vi.mocked(listAgents).mockReturnValue([
      {
        name: "scheduled-test",
        entry: {
          type: "scheduled",
          sessionId: null,
          status: "idle",
          createdAt: "2026-04-25T00:00:00Z",
          schedule: { cron: "* * * * *" },
          taskPrompt: "do something",
          cwd: "/tmp",
          stateDir: "/tmp/state",
          lastRunAt: null,
          nextRunAt: pastTime,
          paused: false,
        },
      },
    ]);

    checkSchedules();

    expect(triggerScheduledAgent).toHaveBeenCalledOnce();
    expect(updateScheduledAgent).toHaveBeenCalled();
  });

  it("skips paused agents", () => {
    vi.mocked(listAgents).mockReturnValue([
      {
        name: "scheduled-paused",
        entry: {
          type: "scheduled",
          sessionId: null,
          status: "idle",
          createdAt: "2026-04-25T00:00:00Z",
          schedule: { cron: "* * * * *" },
          taskPrompt: "do something",
          cwd: "/tmp",
          stateDir: "/tmp/state",
          lastRunAt: null,
          nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          paused: true,
        },
      },
    ]);

    checkSchedules();

    expect(triggerScheduledAgent).not.toHaveBeenCalled();
  });

  it("skips active (already running) agents", () => {
    vi.mocked(listAgents).mockReturnValue([
      {
        name: "scheduled-running",
        entry: {
          type: "scheduled",
          sessionId: "sess-123",
          status: "active",
          createdAt: "2026-04-25T00:00:00Z",
          schedule: { cron: "* * * * *" },
          taskPrompt: "do something",
          cwd: "/tmp",
          stateDir: "/tmp/state",
          lastRunAt: null,
          nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          paused: false,
        },
      },
    ]);

    checkSchedules();

    expect(triggerScheduledAgent).not.toHaveBeenCalled();
  });

  it("skips agents not yet due", () => {
    vi.mocked(listAgents).mockReturnValue([
      {
        name: "scheduled-future",
        entry: {
          type: "scheduled",
          sessionId: null,
          status: "idle",
          createdAt: "2026-04-25T00:00:00Z",
          schedule: { cron: "0 12 * * *" },
          taskPrompt: "do something",
          cwd: "/tmp",
          stateDir: "/tmp/state",
          lastRunAt: null,
          nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
          paused: false,
        },
      },
    ]);

    checkSchedules();

    expect(triggerScheduledAgent).not.toHaveBeenCalled();
  });

  it("pauses one-shot schedules after triggering", () => {
    vi.mocked(listAgents).mockReturnValue([
      {
        name: "scheduled-oneshot",
        entry: {
          type: "scheduled",
          sessionId: null,
          status: "idle",
          createdAt: "2026-04-25T00:00:00Z",
          schedule: { runAt: new Date(Date.now() - 60_000).toISOString() },
          taskPrompt: "do something once",
          cwd: "/tmp",
          stateDir: "/tmp/state",
          lastRunAt: null,
          nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          paused: false,
        },
      },
    ]);

    checkSchedules();

    expect(triggerScheduledAgent).toHaveBeenCalledOnce();
    // One-shot: computeNextRun returns null, so scheduler should pause
    expect(updateScheduledAgent).toHaveBeenCalledWith("scheduled-oneshot", {
      nextRunAt: null,
      paused: true,
    });
  });

  it("skips destroyed agents", () => {
    vi.mocked(listAgents).mockReturnValue([
      {
        name: "scheduled-dead",
        entry: {
          type: "scheduled",
          sessionId: null,
          status: "destroyed",
          createdAt: "2026-04-25T00:00:00Z",
          schedule: { cron: "* * * * *" },
          taskPrompt: "do something",
          cwd: "/tmp",
          stateDir: "/tmp/state",
          lastRunAt: null,
          nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          paused: false,
        },
      },
    ]);

    checkSchedules();

    expect(triggerScheduledAgent).not.toHaveBeenCalled();
  });
});
