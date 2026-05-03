import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ── Capture tool handlers via SDK mock ────────────────────────────────────

const capturedTools = new Map<string, Function>();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn(({ tools }: { tools: any[] }) => {
    capturedTools.clear();
    for (const t of tools) capturedTools.set(t._name, t._handler);
    return { type: "sdk", name: "friday-threads" };
  }),
  tool: vi.fn(
    (name: string, _desc: string, _schema: any, handler: Function) => ({
      _name: name,
      _handler: handler,
    })
  ),
}));

// ── Other mocks ───────────────────────────────────────────────────────────

vi.mock("../sessions/registry.js", () => ({
  getAgent: vi.fn(),
}));

vi.mock("./thread-registry.js", () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getByAgent: vi.fn(),
  getByThread: vi.fn(),
}));

vi.mock("./helpers.js", () => ({
  addReaction: vi.fn().mockResolvedValue({ ok: true }),
  removeReaction: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../agent/lifecycle.js", () => ({
  notifyThreadConnect: vi.fn(),
  notifyThreadDisconnect: vi.fn(),
}));

vi.mock("../log.js", () => ({ log: vi.fn() }));

// ── Import after mocking ──────────────────────────────────────────────────

import { getAgent } from "../sessions/registry.js";
import {
  connect,
  disconnect,
  getByAgent,
  getByThread,
} from "./thread-registry.js";
import { addReaction, removeReaction } from "./helpers.js";
import { notifyThreadConnect, notifyThreadDisconnect } from "../agent/lifecycle.js";
import { createThreadTools } from "./thread-tools.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: "999.000" }),
    },
  } as any;
}

async function callTool(
  client: any,
  toolName: string,
  args: Record<string, string>
): Promise<{ text: string; isError?: boolean }> {
  createThreadTools(client); // triggers createSdkMcpServer, populates capturedTools
  const handler = capturedTools.get(toolName);
  if (!handler) throw new Error(`Tool "${toolName}" not captured`);
  const result = await handler(args);
  return { text: result.content[0].text, isError: result.isError };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("thread_connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: connects, adds :link: reaction, posts message, notifies agent", async () => {
    const client = makeClient();
    (getAgent as Mock).mockReturnValue({ status: "active" });
    (getByThread as Mock).mockReturnValue(undefined);
    (connect as Mock).mockReturnValue({ ok: true });

    const result = await callTool(client, "thread_connect", {
      agent_name: "builder-foo",
      channel_id: "C001",
      thread_ts: "111.222",
      anchor_ts: "111.222",
    });

    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("builder-foo");
    expect(addReaction).toHaveBeenCalledWith(expect.anything(), "C001", "111.222", "link");
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: "111.222" })
    );
    expect(notifyThreadConnect).toHaveBeenCalledWith("builder-foo", "C001", "111.222");
  });

  it("returns error when agent not found", async () => {
    const client = makeClient();
    (getAgent as Mock).mockReturnValue(undefined);

    const result = await callTool(client, "thread_connect", {
      agent_name: "builder-missing",
      channel_id: "C001",
      thread_ts: "111.222",
      anchor_ts: "111.222",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("not found");
    expect(connect).not.toHaveBeenCalled();
  });

  it("returns error when thread already owned by different agent", async () => {
    const client = makeClient();
    (getAgent as Mock).mockReturnValue({ status: "active" });
    (getByThread as Mock).mockReturnValue({
      agentName: "builder-other",
      channelId: "C001",
      threadTs: "111.222",
    });

    const result = await callTool(client, "thread_connect", {
      agent_name: "builder-new",
      channel_id: "C001",
      thread_ts: "111.222",
      anchor_ts: "111.222",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("builder-other");
  });

  it("handles stolen connection: notifies old thread and removes old reaction", async () => {
    const client = makeClient();
    (getAgent as Mock).mockReturnValue({ status: "active" });
    (getByThread as Mock).mockReturnValue(undefined);
    (connect as Mock).mockReturnValue({
      ok: true,
      stolen: { agentName: "builder-foo", channelId: "C001", threadTs: "000.111" },
    });

    await callTool(client, "thread_connect", {
      agent_name: "builder-foo",
      channel_id: "C002",
      thread_ts: "222.333",
      anchor_ts: "222.333",
    });

    // Should post to OLD thread and remove old :link:
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: "000.111", channel: "C001" })
    );
    expect(removeReaction).toHaveBeenCalledWith(expect.anything(), "C001", "000.111", "link");
    expect(notifyThreadDisconnect).toHaveBeenCalledWith("builder-foo", "stolen");
  });
});

describe("thread_disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: disconnects, removes :link: reaction, posts message, notifies agent", async () => {
    const client = makeClient();
    (getByAgent as Mock).mockReturnValue({
      agentName: "builder-foo",
      channelId: "C001",
      threadTs: "111.222",
    });
    (disconnect as Mock).mockReturnValue({
      agentName: "builder-foo",
      channelId: "C001",
      threadTs: "111.222",
    });

    const result = await callTool(client, "thread_disconnect", {
      agent_name: "builder-foo",
    });

    expect(result.isError).toBeFalsy();
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: "111.222", text: "Disconnected." })
    );
    expect(removeReaction).toHaveBeenCalledWith(expect.anything(), "C001", "111.222", "link");
    expect(notifyThreadDisconnect).toHaveBeenCalledWith("builder-foo", "manual");
  });

  it("returns error when agent not connected", async () => {
    const client = makeClient();
    (getByAgent as Mock).mockReturnValue(undefined);

    const result = await callTool(client, "thread_disconnect", {
      agent_name: "builder-unconnected",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("not connected");
    expect(disconnect).not.toHaveBeenCalled();
  });
});
