import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkillsFromDir, loadAllSkills, SkillRegistry } from "./skills.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function writeSkill(
  dir: string,
  name: string,
  content: string
): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content);
}

// ── loadSkillsFromDir ─────────────────────────────────────────────────────

describe("loadSkillsFromDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `skills-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for non-existent directory", () => {
    expect(loadSkillsFromDir("/does/not/exist")).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    expect(loadSkillsFromDir(tmpDir)).toEqual([]);
  });

  it("parses a basic skill", () => {
    writeSkill(
      tmpDir,
      "review",
      `---
description: Review a pull request
when_to_use: When user asks to review a PR
user-invocable: true
scope: [builder]
---
Review the current branch changes.`
    );

    const skills = loadSkillsFromDir(tmpDir);
    expect(skills).toHaveLength(1);
    const s = skills[0];
    expect(s.name).toBe("review");
    expect(s.description).toBe("Review a pull request");
    expect(s.whenToUse).toBe("When user asks to review a PR");
    expect(s.userInvocable).toBe(true);
    expect(s.scope).toEqual(["builder"]);
    expect(s.body).toBe("Review the current branch changes.");
    expect(s.disableModelInvocation).toBe(false);
  });

  it("defaults: empty scope, disable-model-invocation false, user-invocable true", () => {
    writeSkill(tmpDir, "simple", `---\ndescription: A simple skill\n---\nDo things.`);
    const [s] = loadSkillsFromDir(tmpDir);
    expect(s.scope).toEqual([]);
    expect(s.disableModelInvocation).toBe(false);
    expect(s.userInvocable).toBe(true);
  });

  it("parses multi-scope", () => {
    writeSkill(tmpDir, "multi", `---\ndescription: Multi\nscope: [orchestrator, builder]\n---\nBody.`);
    const [s] = loadSkillsFromDir(tmpDir);
    expect(s.scope).toEqual(["orchestrator", "builder"]);
  });

  it("parses disable-model-invocation: true", () => {
    writeSkill(
      tmpDir,
      "explicit",
      `---\ndescription: Explicit only\ndisable-model-invocation: true\n---\nBody.`
    );
    const [s] = loadSkillsFromDir(tmpDir);
    expect(s.disableModelInvocation).toBe(true);
  });

  it("skips directories without SKILL.md", () => {
    mkdirSync(join(tmpDir, "no-skill"));
    writeSkill(tmpDir, "valid", `---\ndescription: Valid\n---\nBody.`);
    expect(loadSkillsFromDir(tmpDir)).toHaveLength(1);
  });

  it("handles skill with no frontmatter gracefully", () => {
    writeSkill(tmpDir, "raw", "Just raw content, no frontmatter.");
    const [s] = loadSkillsFromDir(tmpDir);
    expect(s.description).toBe("");
    expect(s.body).toBe("Just raw content, no frontmatter.");
  });
});

// ── SkillRegistry ─────────────────────────────────────────────────────────

describe("SkillRegistry", () => {
  const skills = [
    {
      name: "review",
      description: "Review PR",
      whenToUse: "",
      disableModelInvocation: false,
      userInvocable: true,
      scope: ["builder"] as const,
      body: "Review body",
    },
    {
      name: "grill-me",
      description: "Grill a plan",
      whenToUse: "",
      disableModelInvocation: false,
      userInvocable: true,
      scope: ["orchestrator"] as const,
      body: "Grill body",
    },
    {
      name: "all-agents",
      description: "Available everywhere",
      whenToUse: "",
      disableModelInvocation: false,
      userInvocable: true,
      scope: [] as const,
      body: "All body",
    },
    {
      name: "explicit-only",
      description: "No auto-trigger",
      whenToUse: "",
      disableModelInvocation: true,
      userInvocable: true,
      scope: [] as const,
      body: "Explicit body",
    },
  ];

  const registry = new SkillRegistry(skills as any);

  it("getByName returns skill", () => {
    expect(registry.getByName("review")?.name).toBe("review");
    expect(registry.getByName("nonexistent")).toBeUndefined();
  });

  it("getSkillsForAgent returns scoped skills + empty-scope skills", () => {
    const builderSkills = registry.getSkillsForAgent("builder");
    const names = builderSkills.map((s) => s.name).sort();
    expect(names).toContain("review");
    expect(names).toContain("all-agents");
    expect(names).toContain("explicit-only");
    expect(names).not.toContain("grill-me");
  });

  it("getAutoTriggerSkills excludes disableModelInvocation skills", () => {
    const auto = registry.getAutoTriggerSkills("builder");
    expect(auto.map((s) => s.name)).not.toContain("explicit-only");
    expect(auto.map((s) => s.name)).toContain("review");
  });

  it("empty scope means all agent types see the skill", () => {
    for (const type of ["orchestrator", "builder", "helper", "bare"] as const) {
      const skills = registry.getSkillsForAgent(type);
      expect(skills.map((s) => s.name)).toContain("all-agents");
    }
  });
});

// ── Override behavior ─────────────────────────────────────────────────────

describe("loadAllSkills user override", () => {
  it("is a function that returns a SkillRegistry", () => {
    // Just ensure the function exists and doesn't throw when called
    // (built-in skills may or may not be present in test environment)
    const registry = loadAllSkills();
    expect(registry).toBeInstanceOf(SkillRegistry);
  });
});
