import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `friday-evolve-clusters-${process.pid}-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => testDir };
});

const { saveProposal, getProposal } = await import("./store.js");
const { mergeClusters, listClusters, getCluster } = await import("./clusters.js");
type Signal = import("./store.js").Signal;

function sig(hash: string): Signal {
  return {
    hash,
    source: "daemon",
    key: `event-${hash}`,
    severity: "high",
    count: 1,
    firstSeenAt: "2026-04-26T00:00:00.000Z",
    lastSeenAt: "2026-04-26T00:00:00.000Z",
    evidencePointers: [],
  };
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("mergeClusters", () => {
  it("does nothing when there are fewer than 2 proposals", () => {
    saveProposal({
      title: "lonely",
      type: "memory",
      proposedChange: "x",
      signals: [sig("aa")],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "test",
    });

    const result = mergeClusters();
    expect(result.clustersCreated).toHaveLength(0);
    expect(listClusters()).toHaveLength(0);
  });

  it("clusters proposals whose signal sets overlap above the threshold", () => {
    const a = saveProposal({
      title: "a fail",
      type: "memory",
      proposedChange: "x",
      signals: [sig("h1"), sig("h2")],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "test",
    });
    const b = saveProposal({
      title: "b fail",
      type: "memory",
      proposedChange: "x",
      signals: [sig("h2"), sig("h3")],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "test",
    });
    const c = saveProposal({
      title: "unrelated",
      type: "memory",
      proposedChange: "x",
      signals: [sig("zz")],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "test",
    });

    // a vs b: union = {h1,h2,h3}, intersection = {h2} → 1/3 ≈ 0.33. Use lower threshold.
    const result = mergeClusters({ threshold: 0.3 });
    expect(result.clustersCreated).toHaveLength(1);
    expect(result.proposalsAttached).toBe(2);

    const cluster = listClusters()[0];
    expect(cluster.members.sort()).toEqual([a.id, b.id].sort());
    expect(cluster.members).not.toContain(c.id);

    // The on-disk proposals should now reference the cluster id.
    const storedA = getProposal(a.id);
    expect(storedA?.clusterId).toBe(cluster.id);
  });

  it("re-uses an existing clusterId when re-merging the same component", () => {
    saveProposal({
      title: "a",
      type: "memory",
      proposedChange: "x",
      signals: [sig("h1"), sig("h2")],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "test",
    });
    saveProposal({
      title: "b",
      type: "memory",
      proposedChange: "x",
      signals: [sig("h1"), sig("h2"), sig("h3")],
      blastRadius: "low",
      appliesTo: [],
      createdBy: "test",
    });

    const first = mergeClusters({ threshold: 0.5 });
    expect(first.clustersCreated).toHaveLength(1);
    const firstClusterId = first.clustersCreated[0].id;

    const second = mergeClusters({ threshold: 0.5 });
    expect(second.clustersCreated).toHaveLength(0);
    expect(second.clustersUpdated).toHaveLength(1);
    expect(second.clustersUpdated[0].id).toBe(firstClusterId);
    expect(getCluster(firstClusterId)).not.toBeNull();
  });
});
