import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

const mockMailEvents = new EventEmitter();
const mockBuildMailPrompt = vi.fn<() => string | null>().mockReturnValue(null);
const mockMailCheck = vi.fn().mockReturnValue([]);
vi.mock("../comms/mail.js", () => ({
  buildMailPrompt: (...args: any[]) => mockBuildMailPrompt(...args),
  mailCheck: (...args: any[]) => mockMailCheck(...args),
  mailEvents: mockMailEvents,
}));

vi.mock("../comms/mail-tools.js", () => ({
  createMailTools: vi.fn(() => ({ type: "sdk", name: "friday-mail" })),
}));

vi.mock("./prime.js", () => ({
  buildAgentSystemPrompt: vi.fn(() => "system prompt"),
  buildFirstTurnPrompt: vi.fn(() => "first turn prompt"),
}));

vi.mock("./workspace.js", () => ({
  createWorkspace: vi.fn(() => ({
    path: "/tmp/test-workspace",
    worktrees: [],
  })),
  destroyWorkspace: vi.fn(),
}));

vi.mock("../sessions/registry.js", () => ({
  registerBuilder: vi.fn(),
  registerHelper: vi.fn(),
  registerOrchestrator: vi.fn(),
  updateAgentSession: vi.fn(),
  updateAgentStatus: vi.fn(),
  destroyAgent: vi.fn(),
  getAgent: vi.fn(),
  listAgents: vi.fn(() => []),
}));

vi.mock("../monitor/usage.js", () => ({ logUsage: vi.fn() }));
vi.mock("../monitor/agent-health.js", () => ({
  recordActivity: vi.fn(),
  clearActivity: vi.fn(),
}));
vi.mock("../events/bus.js", () => ({
  eventBus: { publish: vi.fn() },
}));
vi.mock("../log.js", () => ({ log: vi.fn() }));

// ── Helpers ────────────────────────────────────────────────────────────────

/** Async generator yielding a single success result message */
async function* makeSuccessResult(sessionId = "sess-test") {
  yield {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    usage: { input_tokens: 100, output_tokens: 50 },
    total_cost_usd: 0.001,
    duration_ms: 100,
  };
}

// ── Import under test (after mocks are set up) ─────────────────────────────

const { createHelper, restoreActiveAgents } = await import("./lifecycle.js");

const { listAgents } = await import("../sessions/registry.js");

// ── Tests ──────────────────────────────────────────────────────────────────

describe("runAgentLoop idle-wait invariant", () => {
  let abort: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    abort = new AbortController();
    mockQuery.mockImplementation(() => makeSuccessResult());
    mockBuildMailPrompt.mockReturnValue(null);
    mockMailCheck.mockReturnValue([]);
  });

  afterEach(async () => {
    abort.abort();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("runs exactly one query turn when no mail follows the initial turn", async () => {
    // No mail ever — buildMailPrompt always returns null
    mockBuildMailPrompt.mockReturnValue(null);

    await createHelper({
      name: "helper-idle-test",
      parent: "builder-test",
      taskId: null,
      cwd: "/tmp/test",
      model: "claude-test",
      allowedTools: [],
    });

    // Let the initial turn complete and microtasks flush
    await vi.advanceTimersByTimeAsync(0);

    const callsAfterFirstTurn = mockQuery.mock.calls.length;
    expect(callsAfterFirstTurn).toBe(1);

    // Advance past the 60s fallback timer — spurious wakeup with no mail
    await vi.advanceTimersByTimeAsync(65_000);

    // Must still be exactly 1 call — the idle loop must not re-run query
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not re-run query on repeated 60s timer firings with no mail", async () => {
    mockBuildMailPrompt.mockReturnValue(null);

    await createHelper({
      name: "helper-timer-test",
      parent: "builder-test",
      taskId: null,
      cwd: "/tmp/test",
      model: "claude-test",
      allowedTools: [],
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Fire the fallback timer multiple times
    await vi.advanceTimersByTimeAsync(65_000);
    await vi.advanceTimersByTimeAsync(65_000);
    await vi.advanceTimersByTimeAsync(65_000);

    // Still only the one initial turn — no stale-prompt re-injection
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("runs a second query turn only when buildMailPrompt returns actual mail", async () => {
    const mailPrompt = 'You have 1 new message:\n\n- friday-abc: from=orchestrator subject="Approved"';

    // First turn: no mail. Then mail arrives.
    mockBuildMailPrompt
      .mockReturnValueOnce(null)     // inter-turn check after turn 1 → go idle
      .mockReturnValueOnce(mailPrompt); // check after idle wakeup → run turn 2

    await createHelper({
      name: "helper-mail-wakeup",
      parent: "builder-test",
      taskId: null,
      cwd: "/tmp/test",
      model: "claude-test",
      allowedTools: [],
    });

    // Turn 1 completes, inter-turn check returns null → idle
    await vi.advanceTimersByTimeAsync(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Simulate a mail push event waking the idle loop
    mockMailEvents.emit("mail:helper-mail-wakeup", "friday-abc");
    await vi.advanceTimersByTimeAsync(0);

    // Now turn 2 should have been triggered with the mail prompt
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const secondCallPrompt = mockQuery.mock.calls[1][0].prompt;
    expect(secondCallPrompt).toBe(mailPrompt);
  });

  it("stays idle when push event fires but mail is already processed", async () => {
    // Both the inter-turn check and the idle wakeup check return null
    mockBuildMailPrompt.mockReturnValue(null);

    await createHelper({
      name: "helper-processed-push",
      parent: "builder-test",
      taskId: null,
      cwd: "/tmp/test",
      model: "claude-test",
      allowedTools: [],
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Push event for an already-closed message — buildMailPrompt still returns null
    mockMailEvents.emit("mail:helper-processed-push", "friday-closed");
    await vi.advanceTimersByTimeAsync(0);

    // Should not trigger a new query turn
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("inter-turn mail check triggers second turn without going idle", async () => {
    const mailPrompt = 'You have 1 new message:\n\n- friday-xyz: from=orchestrator subject="Go"';

    // Mail is available immediately after turn 1 (inter-turn check, before going idle)
    mockBuildMailPrompt
      .mockReturnValueOnce(mailPrompt) // inter-turn check: mail found, continue
      .mockReturnValue(null);          // after turn 2: go idle, no more mail

    await createHelper({
      name: "helper-inter-turn",
      parent: "builder-test",
      taskId: null,
      cwd: "/tmp/test",
      model: "claude-test",
      allowedTools: [],
    });

    // Both turns should run in microtask resolution
    await vi.advanceTimersByTimeAsync(0);

    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Second turn should use the mail prompt
    expect(mockQuery.mock.calls[1][0].prompt).toBe(mailPrompt);

    // No more turns after 60s idle
    await vi.advanceTimersByTimeAsync(65_000);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  // Regression test for the bug class this PR fixes: when an agent is resumed
  // via restoreActiveAgents (i.e. with a stored sessionId from the registry),
  // the idle loop must not re-run query() with a stale prompt just because the
  // 60s fallback timer fires. Prior to the fix, the outer loop would re-enter
  // with whatever `prompt` was last assigned, causing already-closed mail to
  // be re-delivered to the agent.
  it("resumed agent does not re-run query on idle timer firings without fresh mail", async () => {
    mockBuildMailPrompt.mockReturnValue(null);

    vi.mocked(listAgents).mockImplementation((filter?: any) => {
      if (filter?.status === "active") {
        return [{
          name: "helper-resumed",
          entry: {
            type: "helper",
            parent: "builder-test",
            sessionId: "sess-resumed-abc",
            status: "active",
            taskId: null,
            cwd: "/tmp/test",
            createdAt: "2026-04-26T00:00:00Z",
          },
        }];
      }
      return [];
    });

    restoreActiveAgents("claude-test");

    // First turn (the resume "check-in") should run exactly once.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Confirm we resumed: query options should include resume: <sessionId>.
    expect(mockQuery.mock.calls[0][0].options.resume).toBe("sess-resumed-abc");

    // Fire the 60s fallback timer multiple times — no new mail, no re-run.
    await vi.advanceTimersByTimeAsync(65_000);
    await vi.advanceTimersByTimeAsync(65_000);
    await vi.advanceTimersByTimeAsync(65_000);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
