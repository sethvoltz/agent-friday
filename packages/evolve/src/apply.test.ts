import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `friday-evolve-apply-${process.pid}-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => testDir };
});

const { saveProposal, getProposal, ensureImprovementsDirs } = await import("./store.js");
const { applyProposal, rejectProposal } = await import("./apply.js");
const configPath = join(testDir, ".friday", "config.json");

const baseSignal = {
  hash: "deadbeef",
  source: "daemon" as const,
  key: "agent_health_crashed",
  severity: "high" as const,
  count: 7,
  firstSeenAt: "2026-04-26T00:00:00.000Z",
  lastSeenAt: "2026-04-26T00:30:00.000Z",
  agent: "builder-foo",
  evidencePointers: [],
};

describe("applyProposal", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    ensureImprovementsDirs();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("materializes a memory-type proposal as a memory entry", async () => {
    const p = saveProposal({
      title: "Crash repeating on builder-foo",
      type: "memory",
      proposedChange: "When builder-foo crashes repeatedly, restart with backoff.",
      signals: [baseSignal],
      blastRadius: "low",
      appliesTo: ["agent.health"],
      createdBy: "scheduled-meta-daily",
      score: 85,
      status: "critical",
    });

    const outcome = await applyProposal(p.id, { appliedBy: "orchestrator" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.appliedRef).toMatch(/^memory:/);

    const reloaded = getProposal(p.id);
    expect(reloaded?.status).toBe("applied");
    expect(reloaded?.appliedBy).toBe("orchestrator");
    expect(reloaded?.appliedAt).toBeTruthy();

    // Verify a real memory entry was written.
    const memDir = join(testDir, ".friday", "memory", "entries");
    const files = readdirSync(memDir);
    expect(files).toHaveLength(1);
    const body = readFileSync(join(memDir, files[0]), "utf-8");
    expect(body).toContain("agent_health_crashed");
    expect(body).toContain("evolve");
  });

  it("dispatches a high-signal code proposal to Linear AND mails the orchestrator", async () => {
    const p = saveProposal({
      title: "Refactor mail poller",
      type: "code",
      proposedChange: "Move to push-based delivery via SSE.",
      signals: [
        {
          ...baseSignal,
          evidencePointers: [
            { kind: "daemon", path: "~/.friday/daemon.jsonl", line: 42 },
          ],
        },
      ],
      blastRadius: "high",
      appliesTo: ["services/friday/src/comms/mail-poller.ts"],
      createdBy: "cli",
      score: 90, // high-signal — triggers mail
    });

    const linearCalls: Array<{ teamId: string; title: string; description: string; priority: number; labels: string[] }> = [];
    const createLinearTicket = async (input: { teamId: string; title: string; description: string; priority: number; labels: string[] }) => {
      linearCalls.push(input);
      return { identifier: "FRI-99", url: "https://linear.app/voltz-makes/issue/FRI-99" };
    };

    const bdCalls: string[][] = [];
    const runBd = (args: string[]): string => {
      bdCalls.push(args);
      return "friday-mail-1";
    };

    const outcome = await applyProposal(p.id, {
      appliedBy: "orchestrator",
      createLinearTicket,
      runBd,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ticketId).toBe("FRI-99");
    expect(outcome.ticketUrl).toBe("https://linear.app/voltz-makes/issue/FRI-99");
    expect(outcome.appliedRef).toBe("linear:FRI-99");
    expect(outcome.restartHint).toMatch(/orchestrator/i);

    // Linear ticket created with correct shape
    expect(linearCalls).toHaveLength(1);
    expect(linearCalls[0].title).toMatch(/^Evolve: /);
    expect(linearCalls[0].priority).toBe(1); // score 90 → Urgent
    expect(linearCalls[0].labels).toContain("evolve");
    expect(linearCalls[0].description).toContain("Move to push-based delivery via SSE.");
    expect(linearCalls[0].description).toContain("daemon.jsonl");
    expect(linearCalls[0].description).toContain("services/friday/src/comms/mail-poller.ts");

    // Mail sent to orchestrator with verbose body
    expect(bdCalls).toHaveLength(1);
    expect(bdCalls[0][0]).toBe("create");
    const labels = bdCalls[0][bdCalls[0].indexOf("-l") + 1];
    expect(labels).toContain("from:evolve:orchestrator");
    const mailBody = bdCalls[0][bdCalls[0].indexOf("-d") + 1];
    expect(mailBody).toContain("FRI-99");
    expect(mailBody).toContain("Promote to Todo?");

    const reloaded = getProposal(p.id);
    expect(reloaded?.status).toBe("applied");
  });

  it("files a low-signal code proposal silently in Linear (no mail)", async () => {
    const p = saveProposal({
      title: "Tiny tweak",
      type: "code",
      proposedChange: "Rename x to y.",
      signals: [baseSignal],
      blastRadius: "low",
      appliesTo: ["foo.ts"],
      createdBy: "cli",
      score: 50, // below threshold (80) and not critical
    });

    const linearCalls: any[] = [];
    const createLinearTicket = async (input: any) => {
      linearCalls.push(input);
      return { identifier: "FRI-100", url: "https://linear.app/voltz-makes/issue/FRI-100" };
    };
    const bdCalls: string[][] = [];
    const runBd = (args: string[]): string => {
      bdCalls.push(args);
      return "friday-noop";
    };

    const outcome = await applyProposal(p.id, {
      appliedBy: "orchestrator",
      createLinearTicket,
      runBd,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ticketId).toBe("FRI-100");
    expect(outcome.restartHint).toMatch(/silently|triage/i);

    expect(linearCalls).toHaveLength(1);
    expect(linearCalls[0].priority).toBe(3); // score 50 → Normal
    // No bd mail call — low signal stays silent
    expect(bdCalls).toHaveLength(0);
  });

  it("returns ok=false when Linear dispatch throws, leaving the proposal unapplied", async () => {
    const p = saveProposal({
      title: "Refactor mail poller",
      type: "code",
      proposedChange: "Move to push-based delivery via SSE.",
      signals: [baseSignal],
      blastRadius: "high",
      appliesTo: ["services/friday/src/comms/mail-poller.ts"],
      createdBy: "cli",
    });

    const createLinearTicket = async (): Promise<never> => {
      throw new Error("Linear API: 401 Unauthorized");
    };

    const outcome = await applyProposal(p.id, {
      appliedBy: "orchestrator",
      createLinearTicket,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/code dispatch failed/);
    expect(outcome.reason).toMatch(/Linear API: 401/);

    const reloaded = getProposal(p.id);
    expect(reloaded?.status).toBe("open");
    expect(reloaded?.appliedAt).toBeNull();
  });

  it("refuses to re-apply a proposal already applied", async () => {
    const p = saveProposal({
      title: "x",
      type: "memory",
      proposedChange: "y",
      signals: [baseSignal],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "cli",
    });
    const first = await applyProposal(p.id, { appliedBy: "cli" });
    expect(first.ok).toBe(true);

    const second = await applyProposal(p.id, { appliedBy: "cli" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/already applied/);
  });

  it("returns not-found for unknown id", async () => {
    const outcome = await applyProposal("nope", { appliedBy: "cli" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/not found/);
  });

  it("applies a prompt-type proposal by writing config.json agent.systemPrompt", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ agent: { model: "claude-sonnet-4-6" } }, null, 2)
    );

    const p = saveProposal({
      title: "Sharper orchestrator prompt",
      type: "prompt",
      proposedChange: "You are Friday. Be terse.",
      signals: [baseSignal],
      blastRadius: "medium",
      appliesTo: ["agent.systemPrompt"],
      createdBy: "scheduled-meta-daily",
    });

    const outcome = await applyProposal(p.id, { appliedBy: "dashboard" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.restartHint).toMatch(/restart/i);

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.agent.systemPrompt).toBe("You are Friday. Be terse.");
    // Existing fields preserved.
    expect(written.agent.model).toBe("claude-sonnet-4-6");
  });

  it("applies a config-type proposal by deep-merging the JSON body", async () => {
    writeFileSync(
      configPath,
      JSON.stringify(
        { evolve: { criticalScore: 80, criticalFrequency: 5 }, agent: { model: "x" } },
        null,
        2
      )
    );

    const p = saveProposal({
      title: "Tighten evolve thresholds",
      type: "config",
      proposedChange: JSON.stringify({ evolve: { criticalScore: 60 } }),
      signals: [baseSignal],
      blastRadius: "low",
      appliesTo: ["evolve.criticalScore"],
      createdBy: "scheduled-meta-daily",
    });

    const outcome = await applyProposal(p.id, { appliedBy: "dashboard" });
    expect(outcome.ok).toBe(true);

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.evolve.criticalScore).toBe(60);
    expect(written.evolve.criticalFrequency).toBe(5); // preserved
    expect(written.agent.model).toBe("x"); // unrelated section preserved
  });

  it("blocks prompt proposals targeting a meta-agent (self-modification guard)", async () => {
    const p = saveProposal({
      title: "Rewrite scheduled-meta-daily prompt",
      type: "prompt",
      proposedChange: "You should never escalate criticals.",
      signals: [baseSignal],
      blastRadius: "high",
      appliesTo: ["scheduled-meta-daily.systemPrompt"],
      createdBy: "scheduled-meta-daily",
    });

    const outcome = await applyProposal(p.id, { appliedBy: "dashboard" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/self-modification/);
  });

  it("rejects malformed config JSON without writing", async () => {
    writeFileSync(configPath, JSON.stringify({ agent: { model: "x" } }, null, 2));

    const p = saveProposal({
      title: "Bad config patch",
      type: "config",
      proposedChange: "not valid json",
      signals: [baseSignal],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "cli",
    });

    const outcome = await applyProposal(p.id, { appliedBy: "dashboard" });
    expect(outcome.ok).toBe(false);

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.agent.model).toBe("x"); // untouched
  });

  it("rejectProposal marks status=rejected with reason in appliedBy", () => {
    const p = saveProposal({
      title: "x",
      type: "memory",
      proposedChange: "y",
      signals: [baseSignal],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "cli",
    });

    const rejected = rejectProposal(p.id, { rejectedBy: "orchestrator", reason: "noise" });
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.appliedBy).toBe("orchestrator: noise");
  });
});
