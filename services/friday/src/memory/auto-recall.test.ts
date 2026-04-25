import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `friday-autorecall-${process.pid}-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => testDir };
});

const { saveEntry, ensureMemoryDirs } = await import("@friday/memory");
const { buildMemoryContext } = await import("./auto-recall.js");

describe("buildMemoryContext", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    ensureMemoryDirs();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns null when no memories exist", () => {
    const result = buildMemoryContext("deploy the application");
    expect(result).toBeNull();
  });

  it("returns null when no memories match above threshold", () => {
    saveEntry({
      title: "Database choice",
      content: "We use PostgreSQL for persistence.",
      tags: ["architecture"],
      createdBy: "orchestrator",
    });

    // Query has no keyword overlap
    const result = buildMemoryContext("deploy the application to staging");
    expect(result).toBeNull();
  });

  it("returns matching memories above threshold", () => {
    saveEntry({
      title: "Deployment schedule",
      content: "Always deploy on Friday at 3pm PST.",
      tags: ["deployment"],
      createdBy: "orchestrator",
    });

    const result = buildMemoryContext("when should we deploy");
    expect(result).not.toBeNull();
    expect(result).toContain("Deployment schedule");
    expect(result).toContain("Friday at 3pm PST");
    expect(result).toContain("<memory-context>");
    expect(result).toContain("</memory-context>");
  });

  it("includes tags in output", () => {
    saveEntry({
      title: "Use pnpm",
      content: "The project uses pnpm, not npm or yarn.",
      tags: ["tooling", "preference"],
      createdBy: "orchestrator",
    });

    const result = buildMemoryContext("install dependencies with pnpm");
    expect(result).not.toBeNull();
    expect(result).toContain("[tooling, preference]");
  });

  it("respects limit option", () => {
    for (let i = 0; i < 10; i++) {
      saveEntry({
        title: `Auth decision ${i}`,
        content: `Auth detail number ${i} about the auth system.`,
        tags: ["auth"],
        createdBy: "orchestrator",
      });
    }

    const result = buildMemoryContext("auth decision", { limit: 3 });
    expect(result).not.toBeNull();
    const matches = result!.match(/- \*\*/g);
    expect(matches!.length).toBeLessThanOrEqual(3);
  });

  it("respects minScore option", () => {
    saveEntry({
      title: "Deployment schedule",
      content: "Deploy on Fridays.",
      tags: ["deployment"],
      createdBy: "orchestrator",
    });

    // With a very high threshold, nothing should match
    const result = buildMemoryContext("deploy", { minScore: 100 });
    expect(result).toBeNull();
  });
});
