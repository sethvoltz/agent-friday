import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../sessions/registry.js", () => ({
  listAgents: vi.fn(),
}));
vi.mock("../log.js", () => ({ log: vi.fn() }));

import { listAgents } from "../sessions/registry.js";
import { reconcileLinearTickets, extractBeadIdFromComment } from "./reconcile.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.LINEAR_API_KEY;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.LINEAR_API_KEY;
  else process.env.LINEAR_API_KEY = ORIGINAL_KEY;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LINEAR_API_KEY = "lin_api_test";
});

function mockGraphQLResponse(issues: any[]) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ data: { issues: { nodes: issues } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  ) as unknown as typeof fetch;
}

describe("extractBeadIdFromComment", () => {
  it("extracts bead id from a Friday-bead-marker comment with backticks", () => {
    expect(extractBeadIdFromComment("🔗 Friday bead: `friday-42`")).toBe("friday-42");
  });

  it("extracts bead id without backticks", () => {
    expect(extractBeadIdFromComment("🔗 Friday bead: friday-99")).toBe("friday-99");
  });

  it("returns null when marker is absent", () => {
    expect(extractBeadIdFromComment("Some unrelated comment")).toBeNull();
  });

  it("works when marker is mid-comment", () => {
    expect(
      extractBeadIdFromComment("Notes...\n\n🔗 Friday bead: `friday-7`\n\nMore notes.")
    ).toBe("friday-7");
  });
});

describe("reconcileLinearTickets", () => {
  it("skips silently when LINEAR_API_KEY is unset", async () => {
    delete process.env.LINEAR_API_KEY;
    const postSlack = vi.fn();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await reconcileLinearTickets({ postSlack });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(postSlack).not.toHaveBeenCalled();
  });

  it("reports nothing when all In Progress tickets have a live builder", async () => {
    mockGraphQLResponse([
      {
        id: "L1",
        identifier: "FRI-17",
        title: "Test ticket",
        url: "https://linear.app/v/issue/FRI-17",
        state: { name: "In Progress" },
        comments: { nodes: [{ body: "🔗 Friday bead: `friday-100`" }] },
      },
    ]);
    vi.mocked(listAgents).mockReturnValue([
      {
        name: "builder-test",
        entry: {
          type: "builder",
          parent: "orchestrator",
          sessionId: "s1",
          status: "active",
          workspace: "/tmp/ws",
          epicId: "friday-100",
          linearTicket: "FRI-17",
          createdAt: new Date().toISOString(),
          children: [],
        },
      },
    ]);

    const postSlack = vi.fn();
    await reconcileLinearTickets({ postSlack });

    expect(postSlack).not.toHaveBeenCalled();
  });

  it("posts a Slack message listing orphans (In Progress with bead but no live builder)", async () => {
    mockGraphQLResponse([
      {
        id: "L1",
        identifier: "FRI-17",
        title: "Stranded ticket",
        url: "https://linear.app/v/issue/FRI-17",
        state: { name: "In Progress" },
        comments: { nodes: [{ body: "🔗 Friday bead: `friday-orphan`" }] },
      },
      {
        id: "L2",
        identifier: "FRI-18",
        title: "Healthy ticket",
        url: "https://linear.app/v/issue/FRI-18",
        state: { name: "In Progress" },
        comments: { nodes: [{ body: "🔗 Friday bead: `friday-alive`" }] },
      },
    ]);
    vi.mocked(listAgents).mockReturnValue([
      {
        name: "builder-alive",
        entry: {
          type: "builder",
          parent: "orchestrator",
          sessionId: "s1",
          status: "active",
          workspace: "/tmp/ws",
          epicId: "friday-alive",
          linearTicket: "FRI-18",
          createdAt: new Date().toISOString(),
          children: [],
        },
      },
    ]);

    const postSlack = vi.fn();
    await reconcileLinearTickets({ postSlack });

    expect(postSlack).toHaveBeenCalledOnce();
    const message = postSlack.mock.calls[0][0] as string;
    expect(message).toContain("FRI-17");
    expect(message).toContain("Stranded ticket");
    expect(message).toContain("friday-orphan");
    expect(message).not.toContain("FRI-18"); // Healthy one isn't surfaced
  });

  it("ignores In Progress tickets without a Friday-bead back-reference", async () => {
    mockGraphQLResponse([
      {
        id: "L1",
        identifier: "FRI-50",
        title: "Manually moved by human",
        url: "https://linear.app/v/issue/FRI-50",
        state: { name: "In Progress" },
        comments: { nodes: [{ body: "Started this ticket myself" }] },
      },
    ]);
    vi.mocked(listAgents).mockReturnValue([]);

    const postSlack = vi.fn();
    await reconcileLinearTickets({ postSlack });

    expect(postSlack).not.toHaveBeenCalled();
  });

  it("filters out non-In-Progress states even when type is 'started'", async () => {
    // Linear's type:"started" includes "Ready for Review" — those aren't In Progress
    mockGraphQLResponse([
      {
        id: "L1",
        identifier: "FRI-60",
        title: "Ready for review ticket",
        url: "https://linear.app/v/issue/FRI-60",
        state: { name: "Ready for Review" },
        comments: { nodes: [{ body: "🔗 Friday bead: `friday-ready`" }] },
      },
    ]);
    vi.mocked(listAgents).mockReturnValue([]);

    const postSlack = vi.fn();
    await reconcileLinearTickets({ postSlack });

    expect(postSlack).not.toHaveBeenCalled();
  });

  it("does not throw on Linear API errors — logs and returns", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("Internal Server Error", {
          status: 500,
        })
    ) as unknown as typeof fetch;
    vi.mocked(listAgents).mockReturnValue([]);

    const postSlack = vi.fn();
    await expect(reconcileLinearTickets({ postSlack })).resolves.not.toThrow();
    expect(postSlack).not.toHaveBeenCalled();
  });
});
