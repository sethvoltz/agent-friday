import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineCommand } from "citty";
import { BUILTIN_PROJECT_BASE_DIR } from "@friday/shared";
import { bold, green, yellow, dim } from "../branding.js";

const OK = green("✓");
const SKIP = yellow("○");

/**
 * Copy template files from src into dest, mapping "dot-claude" → ".claude".
 * Skips files that already exist unless --force is passed.
 */
function copyTemplate(src: string, dest: string, force: boolean): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];

  function walk(srcDir: string, destDir: string): void {
    mkdirSync(destDir, { recursive: true });
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = join(srcDir, entry.name);
      // Map the "dot-claude" template directory to ".claude" in the target
      const destName = entry.name === "dot-claude" ? ".claude" : entry.name;
      const destPath = join(destDir, destName);

      if (entry.isDirectory()) {
        walk(srcPath, destPath);
      } else {
        const rel = destPath.slice(dest.length + 1);
        if (!force && existsSync(destPath)) {
          skipped.push(rel);
        } else {
          cpSync(srcPath, destPath);
          copied.push(rel);
        }
      }
    }
  }

  walk(src, dest);
  return { copied, skipped };
}

export const projectBaseCommandCitty = defineCommand({
  meta: {
    name: "project-base",
    description:
      "Seed a repo's .claude/ directory with Friday's standard project-base template " +
      "(settings.json with bd-prime hooks, pre-push-validation rule). " +
      "Safe to run on existing repos — skips files that already exist unless --force is passed.",
  },
  args: {
    dir: {
      type: "positional",
      description: "Target directory (defaults to current working directory)",
      required: false,
    },
    force: {
      type: "boolean",
      alias: "f",
      description: "Overwrite existing files",
      default: false,
    },
  },
  run({ args }) {
    const targetDir = resolve(args.dir ?? ".");

    if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
      console.error(`  Error: ${targetDir} is not a directory`);
      process.exit(1);
    }

    if (!existsSync(BUILTIN_PROJECT_BASE_DIR)) {
      console.error(`  Error: built-in project-base template not found at ${BUILTIN_PROJECT_BASE_DIR}`);
      console.error(`  Try rebuilding: pnpm --filter @friday/shared build`);
      process.exit(1);
    }

    console.log(`\n  ${bold("Friday project-base")}`);
    console.log(`  ${dim("Target:")} ${targetDir}\n`);

    const { copied, skipped } = copyTemplate(BUILTIN_PROJECT_BASE_DIR, targetDir, args.force);

    for (const f of copied) {
      console.log(`     ${OK} ${f}`);
    }
    for (const f of skipped) {
      console.log(`     ${SKIP} ${f}  ${dim("(already exists — use --force to overwrite)")}`);
    }

    if (copied.length === 0 && skipped.length === 0) {
      console.log(`     ${dim("No template files found.")}`);
    } else {
      console.log();
      if (skipped.length > 0 && !args.force) {
        console.log(`  ${dim(`${skipped.length} file(s) skipped. Re-run with --force to overwrite.`)}`);
      }
      if (copied.length > 0) {
        console.log(`  ${dim("Next: fill in the placeholder commands in .claude/rules/pre-push-validation.md")}`);
      }
    }
    console.log();
  },
});
