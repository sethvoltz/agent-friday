import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS_DIR } from "./config.js";
import type { AgentType } from "./agents.js";

export type SkillScope = "orchestrator" | "builder" | "helper" | "bare";

export interface Skill {
  /** Folder name — used as the trigger key for explicit invocation */
  name: string;
  description: string;
  whenToUse: string;
  /** If true, skill is omitted from auto-trigger system prompt injection */
  disableModelInvocation: boolean;
  userInvocable: boolean;
  /** Empty array means skill applies to all agent types */
  scope: SkillScope[];
  /** SKILL.md content after frontmatter is stripped */
  body: string;
}

// Path to the built-in skills directory bundled with this package.
// At runtime: packages/shared/dist/skills.js → ../skills/ = packages/shared/skills/
const _dir = dirname(fileURLToPath(import.meta.url));
export const BUILTIN_SKILLS_DIR = join(_dir, "..", "skills");

// ── Frontmatter parser ────────────────────────────────────────────────────

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = FM_RE.exec(content.trim());
  if (!match) return { meta: {}, body: content };

  const rawMeta = match[1];
  const body = match[2];
  const meta: Record<string, string> = {};

  for (const line of rawMeta.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    meta[key] = val;
  }

  return { meta, body };
}

function parseScope(raw: string | undefined): SkillScope[] {
  if (!raw) return [];
  // Handles: [orchestrator, builder] or orchestrator, builder
  const stripped = raw.replace(/^\[|\]$/g, "").trim();
  if (!stripped) return [];
  return stripped
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SkillScope =>
      ["orchestrator", "builder", "helper", "bare"].includes(s)
    );
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined) return defaultValue;
  return raw.toLowerCase() === "true";
}

function parseSkillMd(name: string, content: string): Skill {
  const { meta, body } = parseFrontmatter(content);
  return {
    name,
    description: meta["description"] ?? "",
    whenToUse: meta["when_to_use"] ?? "",
    disableModelInvocation: parseBool(meta["disable-model-invocation"], false),
    userInvocable: parseBool(meta["user-invocable"], true),
    scope: parseScope(meta["scope"]),
    body: body.trim(),
  };
}

// ── Directory loader ──────────────────────────────────────────────────────

export function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  for (const name of entries) {
    const skillFile = join(dir, name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const content = readFileSync(skillFile, "utf-8");
      skills.push(parseSkillMd(name, content));
    } catch {
      // Skip malformed skill files
    }
  }

  return skills;
}

// ── Registry ──────────────────────────────────────────────────────────────

export class SkillRegistry {
  private readonly byName: Map<string, Skill>;

  constructor(skills: Skill[]) {
    this.byName = new Map(skills.map((s) => [s.name, s]));
  }

  getByName(name: string): Skill | undefined {
    return this.byName.get(name);
  }

  /** Returns skills whose scope includes the given agent type (or whose scope is empty = all). */
  getSkillsForAgent(agentType: AgentType): Skill[] {
    return [...this.byName.values()].filter(
      (s) => s.scope.length === 0 || s.scope.includes(agentType as SkillScope)
    );
  }

  /** Skills that should appear in auto-trigger system prompt injection for a given agent type. */
  getAutoTriggerSkills(agentType: AgentType): Skill[] {
    return this.getSkillsForAgent(agentType).filter((s) => !s.disableModelInvocation);
  }

  get size(): number {
    return this.byName.size;
  }
}

// ── Combined loader ───────────────────────────────────────────────────────

/**
 * Load all skills: built-ins first, then user skills from ~/.friday/skills/.
 * User skills override built-ins when the folder name matches.
 */
export function loadAllSkills(): SkillRegistry {
  const builtins = loadSkillsFromDir(BUILTIN_SKILLS_DIR);
  const userSkills = loadSkillsFromDir(SKILLS_DIR);

  // User skills override built-ins by name
  const merged = new Map<string, Skill>(builtins.map((s) => [s.name, s]));
  for (const s of userSkills) {
    merged.set(s.name, s);
  }

  return new SkillRegistry([...merged.values()]);
}
