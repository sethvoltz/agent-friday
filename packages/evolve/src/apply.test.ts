import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `friday-evolve-apply-${process.pid}-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => testDir };
});

const { saveProposal, getProposal, ensureImprovementsDirs } = await import("./store.js");
const { applyProposal, rejectProposal } = await import("./apply.js");

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

  it("materializes a memory-type proposal as a memory entry", () => {
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

    const outcome = applyProposal(p.id, { appliedBy: "orchestrator" });
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

  it("does not materialize non-memory types but moves status to approved", () => {
    const p = saveProposal({
      title: "Tweak orchestrator system prompt",
      type: "prompt",
      proposedChange: "Add a paragraph about X.",
      signals: [baseSignal],
      blastRadius: "medium",
      appliesTo: ["agent.systemPrompt"],
      createdBy: "cli",
    });

    const outcome = applyProposal(p.id, { appliedBy: "orchestrator" });
    expect(outcome.ok).toBe(false);
    const reloaded = getProposal(p.id);
    expect(reloaded?.status).toBe("approved");
    expect(reloaded?.appliedAt).toBeNull();
  });

  it("refuses to re-apply a proposal already applied", () => {
    const p = saveProposal({
      title: "x",
      type: "memory",
      proposedChange: "y",
      signals: [baseSignal],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "cli",
    });
    const first = applyProposal(p.id, { appliedBy: "cli" });
    expect(first.ok).toBe(true);

    const second = applyProposal(p.id, { appliedBy: "cli" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/already applied/);
  });

  it("returns not-found for unknown id", () => {
    const outcome = applyProposal("nope", { appliedBy: "cli" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/not found/);
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
