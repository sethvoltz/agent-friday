import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../log.js", () => ({
  log: vi.fn(),
}));

const mockMailEvents = new EventEmitter();
const mockMailCheck = vi.fn().mockReturnValue([]);
const mockBuildMailPrompt = vi.fn().mockReturnValue(null);
vi.mock("./mail.js", () => ({
  mailCheck: (...args: any[]) => mockMailCheck(...args),
  buildMailPrompt: (...args: any[]) => mockBuildMailPrompt(...args),
  mailEvents: mockMailEvents,
}));

const { startMailPoller, stopMailPoller } = await import("./mail-poller.js");

function makeMessage(id: string, from: string, subject: string, priority: "normal" | "urgent" = "normal") {
  return {
    id,
    from,
    to: "orchestrator",
    subject,
    body: "",
    priority,
    status: "pending" as const,
    createdAt: "2026-04-23T10:00:00Z",
  };
}

describe("mail-poller", () => {
  let mockOnMail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnMail = vi.fn().mockResolvedValue(undefined);
    mockMailCheck.mockReturnValue([]);
    mockBuildMailPrompt.mockReturnValue(null);
  });

  afterEach(() => {
    stopMailPoller();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not call onMail when no pending mail", async () => {
    startMailPoller({ agentName: "orchestrator", onMail: mockOnMail });

    await vi.advanceTimersByTimeAsync(65_000);
    expect(mockOnMail).not.toHaveBeenCalled();
  });

  it("calls onMail instantly on push event", async () => {
    startMailPoller({ agentName: "orchestrator", onMail: mockOnMail });

    // Set up mail to be found when checkAndNotify runs
    mockMailCheck.mockReturnValue([
      makeMessage("friday-abc", "builder-blog", "Plan ready"),
    ]);
    mockBuildMailPrompt.mockReturnValue(
      'You have 1 new message(s):\n\n- friday-abc: from=builder-blog subject="Plan ready"\n\nRead each with mail_read, act on it, then mail_close it.'
    );

    // Emit push event — should trigger immediately, no timer needed
    mockMailEvents.emit("mail:orchestrator", "friday-abc");

    // Allow microtask to flush
    await vi.advanceTimersByTimeAsync(0);

    expect(mockOnMail).toHaveBeenCalledTimes(1);
    const prompt = mockOnMail.mock.calls[0][0] as string;
    expect(prompt).toContain("builder-blog");
    expect(prompt).toContain("Plan ready");
  });

  it("calls onMail on fallback poll", async () => {
    mockMailCheck.mockReturnValue([
      makeMessage("friday-abc", "builder-blog", "Plan ready"),
    ]);
    mockBuildMailPrompt.mockReturnValue(
      'You have 1 new message(s):\n\n- friday-abc: from=builder-blog subject="Plan ready"\n\nRead each with mail_read, act on it, then mail_close it.'
    );

    startMailPoller({ agentName: "orchestrator", onMail: mockOnMail });

    // Advance past the 60s fallback poll
    await vi.advanceTimersByTimeAsync(61_000);

    expect(mockOnMail).toHaveBeenCalledTimes(1);
  });

  it("includes URGENT flag in prompt", async () => {
    mockMailCheck.mockReturnValue([
      makeMessage("friday-xyz", "builder-auth", "Error!", "urgent"),
    ]);
    mockBuildMailPrompt.mockReturnValue(
      'You have 1 new message(s):\n\n- friday-xyz: from=builder-auth subject="Error!" [URGENT]\n\nRead each with mail_read, act on it, then mail_close it.'
    );

    startMailPoller({ agentName: "orchestrator", onMail: mockOnMail });
    mockMailEvents.emit("mail:orchestrator", "friday-xyz");
    await vi.advanceTimersByTimeAsync(0);

    const prompt = mockOnMail.mock.calls[0][0] as string;
    expect(prompt).toContain("[URGENT]");
  });

  it("does not notify twice for the same message", async () => {
    mockMailCheck.mockReturnValue([
      makeMessage("friday-abc", "builder-blog", "Plan ready"),
    ]);
    mockBuildMailPrompt.mockReturnValue(
      'You have 1 new message(s):\n\n- friday-abc: from=builder-blog subject="Plan ready"\n\nRead each with mail_read, act on it, then mail_close it.'
    );

    startMailPoller({ agentName: "orchestrator", onMail: mockOnMail });
    mockMailEvents.emit("mail:orchestrator", "friday-abc");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockOnMail).toHaveBeenCalledTimes(1);

    // Same message still pending — push again should NOT trigger
    mockMailEvents.emit("mail:orchestrator", "friday-abc");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockOnMail).toHaveBeenCalledTimes(1);
  });

  it("notifies again after message is processed and new one arrives", async () => {
    mockMailCheck.mockReturnValue([
      makeMessage("friday-abc", "builder-blog", "Plan ready"),
    ]);
    mockBuildMailPrompt.mockReturnValue(
      'You have 1 new message(s):\n\n- friday-abc: from=builder-blog subject="Plan ready"\n\nRead each with mail_read, act on it, then mail_close it.'
    );

    startMailPoller({ agentName: "orchestrator", onMail: mockOnMail });
    mockMailEvents.emit("mail:orchestrator", "friday-abc");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockOnMail).toHaveBeenCalledTimes(1);

    // msg1 gone (processed), msg2 arrives
    mockMailCheck.mockReturnValue([
      makeMessage("friday-def", "builder-auth", "Done"),
    ]);
    mockBuildMailPrompt.mockReturnValue(
      'You have 1 new message(s):\n\n- friday-def: from=builder-auth subject="Done"\n\nRead each with mail_read, act on it, then mail_close it.'
    );

    mockMailEvents.emit("mail:orchestrator", "friday-def");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockOnMail).toHaveBeenCalledTimes(2);
    expect(mockOnMail.mock.calls[1][0]).toContain("Done");
  });

  it("stops on stopMailPoller", async () => {
    mockMailCheck.mockReturnValue([
      makeMessage("friday-abc", "builder-blog", "Test"),
    ]);

    startMailPoller({ agentName: "orchestrator", onMail: mockOnMail });
    stopMailPoller();

    mockMailEvents.emit("mail:orchestrator", "friday-abc");
    await vi.advanceTimersByTimeAsync(65_000);
    expect(mockOnMail).not.toHaveBeenCalled();
  });
});
