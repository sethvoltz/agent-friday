import { loadAllSkills, type SkillRegistry } from "@friday/shared";
import { log } from "../log.js";

let _registry: SkillRegistry | null = null;

export function initSkillRegistry(): SkillRegistry {
  if (_registry) return _registry;
  _registry = loadAllSkills();
  log("info", "skills_loaded", { count: _registry.size });
  return _registry;
}

/** Returns the cached registry synchronously. Null if initSkillRegistry() hasn't been called yet. */
export function getSkillRegistry(): SkillRegistry | null {
  return _registry;
}
