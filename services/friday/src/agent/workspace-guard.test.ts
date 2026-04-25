import { describe, it, expect } from "vitest";
import { checkToolCall } from "./workspace-guard.js";

const workspace = "/workspace/builder-test";
const inside = `${workspace}/agent-friday/src/index.ts`;
const outside = "/Users/seth/other-project/secret.ts";

function check(
  tool: string,
  input: Record<string, unknown>
): string | null {
  return checkToolCall(workspace, tool, input);
}

describe("workspace-guard: Read / Write / Edit", () => {
  it("allows file_path inside workspace", () => {
    expect(check("Read", { file_path: inside })).toBeNull();
    expect(check("Write", { file_path: inside })).toBeNull();
    expect(check("Edit", { file_path: inside })).toBeNull();
  });

  it("allows relative paths (not absolute)", () => {
    expect(check("Read", { file_path: "src/index.ts" })).toBeNull();
  });

  it("blocks file_path outside workspace", () => {
    expect(check("Read", { file_path: outside })).toMatch(/Read blocked/);
    expect(check("Write", { file_path: outside })).toMatch(/Write blocked/);
    expect(check("Edit", { file_path: outside })).toMatch(/Edit blocked/);
  });

  it("blocks workspace root itself when attempting parent escape", () => {
    expect(check("Read", { file_path: "/workspace" })).toMatch(/Read blocked/);
  });

  it("blocks path that merely starts with workspace string but is not under it", () => {
    expect(check("Read", { file_path: `${workspace}-other/file.ts` })).toMatch(/Read blocked/);
  });
});

describe("workspace-guard: Glob / Grep", () => {
  it("allows path inside workspace", () => {
    expect(check("Glob", { path: `${workspace}/src` })).toBeNull();
    expect(check("Grep", { path: `${workspace}/src` })).toBeNull();
  });

  it("allows undefined path (no path param)", () => {
    expect(check("Glob", {})).toBeNull();
    expect(check("Grep", {})).toBeNull();
  });

  it("blocks path outside workspace", () => {
    expect(check("Glob", { path: "/Users/seth/other" })).toMatch(/Glob blocked/);
    expect(check("Grep", { path: "/Users/seth/other" })).toMatch(/Grep blocked/);
  });
});

describe("workspace-guard: Bash — cwd check", () => {
  it("allows cwd inside workspace", () => {
    expect(check("Bash", { command: "ls", cwd: `${workspace}/src` })).toBeNull();
  });

  it("allows missing cwd", () => {
    expect(check("Bash", { command: "ls" })).toBeNull();
  });

  it("blocks cwd outside workspace", () => {
    expect(check("Bash", { command: "ls", cwd: "/Users/seth/other" })).toMatch(/Bash blocked.*cwd/);
  });
});

describe("workspace-guard: Bash — command string scan", () => {
  it("allows commands with no absolute paths", () => {
    expect(check("Bash", { command: "npm run build" })).toBeNull();
    expect(check("Bash", { command: "git status" })).toBeNull();
  });

  it("allows absolute paths inside workspace", () => {
    expect(check("Bash", { command: `cat "${inside}"` })).toBeNull();
  });

  it("allows system paths in command", () => {
    expect(check("Bash", { command: "/usr/bin/node dist/index.js" })).toBeNull();
    expect(check("Bash", { command: "/bin/bash -c 'echo hi'" })).toBeNull();
  });

  it("blocks absolute paths to user data outside workspace", () => {
    expect(
      check("Bash", { command: `cat ${outside}` })
    ).toMatch(/Bash blocked.*command references/);
  });
});

describe("workspace-guard: Bash — git worktree exception", () => {
  it("always allows git worktree add", () => {
    expect(
      check("Bash", { command: `git worktree add /some/outside/path feature-x` })
    ).toBeNull();
  });

  it("always allows git worktree remove", () => {
    expect(
      check("Bash", { command: "git worktree remove /outside/path --force" })
    ).toBeNull();
  });

  it("always allows git worktree list", () => {
    expect(check("Bash", { command: "git worktree list" })).toBeNull();
  });

  it("always allows git worktree prune", () => {
    expect(check("Bash", { command: "git worktree prune" })).toBeNull();
  });
});

describe("workspace-guard: Bash — bd exemption", () => {
  it("allows bd commands directly", () => {
    expect(check("Bash", { command: "bd show friday-3wc --json" })).toBeNull();
    expect(check("Bash", { command: "bd create 'Task title'" })).toBeNull();
    expect(check("Bash", { command: "bd close friday-3wc.1" })).toBeNull();
  });
});

describe("workspace-guard: unrecognised tools", () => {
  it("allows unknown tool names", () => {
    expect(check("Agent", { prompt: "do something" })).toBeNull();
    expect(check("WebSearch", { query: "example" })).toBeNull();
    expect(checkToolCall(workspace, undefined, {})).toBeNull();
  });
});
