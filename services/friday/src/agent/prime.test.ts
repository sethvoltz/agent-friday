import { describe, it, expect } from "vitest";
import { buildAgentSystemPrompt, buildFirstTurnPrompt } from "./prime.js";

describe("buildAgentSystemPrompt", () => {
  it("builds orchestrator prompt", () => {
    const prompt = buildAgentSystemPrompt({
      agentName: "orchestrator",
      agentType: "orchestrator",
      cwd: "/tmp",
    });
    expect(prompt).toContain("# Role: Orchestrator");
    expect(prompt).toContain("slack_reply");
    expect(prompt).toContain("`gh`");
    expect(prompt).toContain("`bd`");
    // Must have turn discipline guidance (wording may change)
    expect(prompt).toMatch(/turn/i);
    expect(prompt).toMatch(/background|independent/i);
  });

  it("builds builder prompt with context", () => {
    const prompt = buildAgentSystemPrompt({
      agentName: "builder-auth",
      agentType: "builder",
      cwd: "/tmp/workspaces/builder-auth",
      parent: "orchestrator",
      workspace: "/tmp/workspaces/builder-auth",
      epicId: "bd-a1b2",
    });
    expect(prompt).toContain("# Role: Builder");
    expect(prompt).toContain("builder-auth");
    expect(prompt).toContain("bd-a1b2");
    expect(prompt).toContain("orchestrator");
    expect(prompt).toContain("`gh`");
  });

  it("builds agent prompt with context", () => {
    const prompt = buildAgentSystemPrompt({
      agentName: "agent-auth-tests",
      agentType: "agent",
      cwd: "/tmp/workspaces/builder-auth",
      parent: "builder-auth",
      taskId: "bd-c3d4",
    });
    expect(prompt).toContain("# Role: Agent");
    expect(prompt).toContain("agent-auth-tests");
    expect(prompt).toContain("bd-c3d4");
    expect(prompt).toContain("builder-auth");
  });
});

describe("buildFirstTurnPrompt", () => {
  it("orchestrator prompt mentions bd ready", () => {
    const prompt = buildFirstTurnPrompt({
      agentName: "orchestrator",
      agentType: "orchestrator",
      cwd: "/tmp",
    });
    expect(prompt).toContain("bd ready");
  });

  it("builder prompt references epic ID", () => {
    const prompt = buildFirstTurnPrompt({
      agentName: "builder-auth",
      agentType: "builder",
      cwd: "/tmp",
      epicId: "bd-a1b2",
    });
    expect(prompt).toContain("bd-a1b2");
    expect(prompt).toContain("bd show");
    expect(prompt).toContain("plan");
  });

  it("builder prompt without epic says to wait", () => {
    const prompt = buildFirstTurnPrompt({
      agentName: "builder-auth",
      agentType: "builder",
      cwd: "/tmp",
      epicId: null,
    });
    expect(prompt).toContain("Wait for instructions");
  });

  it("agent prompt references task ID", () => {
    const prompt = buildFirstTurnPrompt({
      agentName: "agent-auth-tests",
      agentType: "agent",
      cwd: "/tmp",
      taskId: "bd-c3d4",
    });
    expect(prompt).toContain("bd-c3d4");
    expect(prompt).toContain("bd show");
  });
});
