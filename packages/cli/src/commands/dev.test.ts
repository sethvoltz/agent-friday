import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadPid = vi.fn().mockReturnValue(null);
const mockIsRunning = vi.fn().mockReturnValue(false);
const mockRemovePid = vi.fn();
const mockParseServiceArg = vi.fn();
const mockFindMonorepoRoot = vi.fn();

vi.mock("../services.js", () => ({
  SERVICES: {
    daemon: { label: "Friday daemon", package: "@friday/daemon", script: "start" },
    dashboard: { label: "Dashboard", package: "@friday/dashboard", script: "preview" },
  },
  readPid: (...args: any[]) => mockReadPid(...args),
  isRunning: (...args: any[]) => mockIsRunning(...args),
  removePid: (...args: any[]) => mockRemovePid(...args),
  parseServiceArg: (...args: any[]) => mockParseServiceArg(...args),
  findMonorepoRoot: () => mockFindMonorepoRoot(),
}));

const mockSpawn = vi.fn().mockReturnValue({ pid: 88 });
vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const fileStore = new Map<string, string>();
const mockExistsSync = vi.fn((path: string) => fileStore.has(path));
const mockReadFileSync = vi.fn((path: string) => fileStore.get(path) ?? "");
const mockWriteFileSync = vi.fn((path: string, data: string) => fileStore.set(path, data));
const mockMkdirSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (p: string) => mockExistsSync(p),
  readFileSync: (p: string, ...args: any[]) => mockReadFileSync(p, ...args),
  writeFileSync: (p: string, d: string) => mockWriteFileSync(p, d),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
}));

// Use real paths from @friday/shared
const FRIDAY_DIR = (await import("@friday/shared")).FRIDAY_DIR;
const AGENTS_PATH = (await import("@friday/shared")).AGENTS_PATH;
const SESSIONS_DIR = (await import("@friday/shared")).SESSIONS_DIR;

const { devCommand } = await import("./dev.js");

describe("devCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMonorepoRoot.mockReturnValue("/fake/root");
    mockParseServiceArg.mockReturnValue("daemon");
  });

  it("requires a subcommand", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
    const mockErr = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => devCommand([])).toThrow("process.exit");

    mockExit.mockRestore();
    mockErr.mockRestore();
  });

  it("dev start spawns with dev script", () => {
    const logs: string[] = [];
    const mock = vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    devCommand(["start", "daemon"]);

    expect(mockSpawn).toHaveBeenCalledWith(
      "pnpm",
      ["--filter", "@friday/daemon", "run", "dev"],
      expect.objectContaining({ cwd: "/fake/root" })
    );

    mock.mockRestore();
  });

  it("dev start all uses pnpm run dev at root", () => {
    mockParseServiceArg.mockReturnValue("all");

    const logs: string[] = [];
    const mock = vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

    devCommand(["start"]);

    expect(mockSpawn).toHaveBeenCalledWith(
      "pnpm",
      ["run", "dev"],
      expect.objectContaining({ cwd: "/fake/root" })
    );

    mock.mockRestore();
  });

  it("rejects unknown dev subcommand", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
    const mockErr = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => devCommand(["bogus"])).toThrow("process.exit");

    mockExit.mockRestore();
    mockErr.mockRestore();
  });

  describe("reset-orchestrator", () => {
    const channelsFile = `${SESSIONS_DIR}/channels.json`;
    const configFile = `${FRIDAY_DIR}/config.json`;

    beforeEach(() => {
      fileStore.clear();
      mockReadPid.mockReturnValue(null);
      mockIsRunning.mockReturnValue(false);
    });

    it("refuses if daemon is running", () => {
      mockReadPid.mockReturnValue(1234);
      mockIsRunning.mockReturnValue(true);

      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit");
      }) as any);
      const mockErr = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => devCommand(["reset-orchestrator"])).toThrow("process.exit");
      expect(mockErr).toHaveBeenCalledWith(expect.stringContaining("Stop it first"));

      mockExit.mockRestore();
      mockErr.mockRestore();
    });

    it("clears orchestrator sessionId and channel mapping", () => {
      fileStore.set(AGENTS_PATH, JSON.stringify({
        orchestrator: { type: "orchestrator", sessionId: "sess-abc", status: "active" },
      }));
      fileStore.set(configFile, JSON.stringify({
        slack: { orchestratorChannelId: "C-orch" },
      }));
      fileStore.set(channelsFile, JSON.stringify({
        "C-orch": "sess-abc",
        "C-other": "sess-xyz",
      }));

      const mock = vi.spyOn(console, "log").mockImplementation(() => {});
      devCommand(["reset-orchestrator"]);
      mock.mockRestore();

      // Verify agents.json was updated
      const agents = JSON.parse(fileStore.get(AGENTS_PATH)!);
      expect(agents.orchestrator.sessionId).toBeNull();

      // Verify channels.json was updated — orchestrator channel removed, other preserved
      const channels = JSON.parse(fileStore.get(channelsFile)!);
      expect(channels["C-orch"]).toBeUndefined();
      expect(channels["C-other"]).toBe("sess-xyz");
    });

    it("reports nothing to reset when already clean", () => {
      const logs: string[] = [];
      const mock = vi.spyOn(console, "log").mockImplementation((msg) => logs.push(String(msg)));

      devCommand(["reset-orchestrator"]);

      expect(logs.join("\n")).toContain("No orchestrator session to reset");
      mock.mockRestore();
    });
  });
});
