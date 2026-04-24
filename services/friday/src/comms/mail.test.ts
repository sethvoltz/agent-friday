import { describe, it, expect, vi, beforeEach } from "vitest";
import { mailSend, mailCheck, mailRead, mailClose } from "./mail.js";

// Mock execSync to capture bd commands
const execResults = new Map<string, string>();
let lastExecCmd = "";

vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    lastExecCmd = cmd;
    // Match on the bd subcommand
    for (const [pattern, result] of execResults) {
      if (cmd.includes(pattern)) {
        return Buffer.from(result);
      }
    }
    return Buffer.from("");
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("../log.js", () => ({
  log: vi.fn(),
}));

beforeEach(() => {
  execResults.clear();
  lastExecCmd = "";
});

describe("mailSend", () => {
  it("creates a beads issue with correct flags", () => {
    execResults.set("bd create", "friday-abc123");

    const id = mailSend({
      from: "orchestrator",
      to: "builder-blog",
      subject: "Start work",
      body: "Please begin the blog project",
    });

    expect(id).toBe("friday-abc123");
    expect(lastExecCmd).toContain("bd create");
    expect(lastExecCmd).toContain("--silent");
    expect(lastExecCmd).toContain("-a \"builder-blog\"");
    expect(lastExecCmd).toContain("type:message");
    expect(lastExecCmd).toContain("delivery:pending");
    expect(lastExecCmd).toContain("from:orchestrator");
    expect(lastExecCmd).toContain("--ephemeral");
  });

  it("adds urgent label and priority for urgent messages", () => {
    execResults.set("bd create", "friday-def456");

    mailSend({
      from: "builder-blog",
      to: "orchestrator",
      subject: "Plan ready",
      body: "Review needed",
      priority: "urgent",
    });

    expect(lastExecCmd).toContain("priority:urgent");
    expect(lastExecCmd).toContain("--priority 1");
  });
});

describe("mailCheck", () => {
  it("returns empty array when no mail", () => {
    execResults.set("bd query", "[]");
    expect(mailCheck("orchestrator")).toEqual([]);
  });

  it("parses pending messages", () => {
    execResults.set(
      "bd query",
      JSON.stringify([
        {
          id: "friday-abc",
          title: "Plan ready",
          description: "Please review",
          assignee: "orchestrator",
          labels: ["type:message", "delivery:pending", "from:builder-blog"],
          created: "2026-04-23T10:00:00Z",
        },
      ])
    );

    const messages = mailCheck("orchestrator");
    expect(messages).toHaveLength(1);
    expect(messages[0].from).toBe("builder-blog");
    expect(messages[0].to).toBe("orchestrator");
    expect(messages[0].subject).toBe("Plan ready");
    expect(messages[0].status).toBe("pending");
  });

  it("returns empty array on query error", () => {
    // No result set — execSync will return empty string
    expect(mailCheck("nonexistent")).toEqual([]);
  });
});

describe("mailRead", () => {
  it("parses message and triggers ack labels", () => {
    execResults.set(
      "bd show",
      JSON.stringify({
        id: "friday-abc",
        title: "Hello",
        description: "World",
        assignee: "builder-blog",
        labels: ["type:message", "delivery:pending", "from:orchestrator"],
        created: "2026-04-23T10:00:00Z",
      })
    );
    execResults.set("bd label", "");

    const msg = mailRead("friday-abc");
    expect(msg.from).toBe("orchestrator");
    expect(msg.subject).toBe("Hello");
    expect(msg.status).toBe("acked");
  });
});

describe("mailClose", () => {
  it("closes the beads issue", () => {
    execResults.set("bd close", "");
    mailClose("friday-abc");
    expect(lastExecCmd).toContain("bd close friday-abc");
  });
});
