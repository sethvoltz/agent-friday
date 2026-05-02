import { listAgents } from "../sessions/registry.js";
import { log } from "../log.js";
import { FRIDAY_BEAD_MARKER, FRIDAY_TEAM_ID } from "./constants.js";

interface ReconcileOptions {
  /** Posts a message to the orchestrator's Slack channel. */
  postSlack: (text: string) => Promise<void>;
}

interface LinearIssueLite {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { name: string };
  comments: { nodes: Array<{ body: string }> };
}

interface LinearGraphQLResponse {
  data?: {
    issues?: { nodes: LinearIssueLite[] };
  };
  errors?: unknown;
}

/**
 * Issue a raw Linear GraphQL request. Daemon code can't call MCP tools the
 * way agents can, so we hit the GraphQL API directly with the same personal
 * API key the MCP uses (Authorization is the raw key value, no `Bearer`).
 */
async function linearGraphQL<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Linear GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) {
    throw new Error("Linear GraphQL: empty data");
  }
  return json.data;
}

/**
 * Parse the bead identifier out of a Friday-bead-marker comment body.
 * Marker format: `🔗 Friday bead: \`friday-42\`` (backticks optional).
 */
export function extractBeadIdFromComment(body: string): string | null {
  if (!body.includes(FRIDAY_BEAD_MARKER)) return null;
  const after = body.split(FRIDAY_BEAD_MARKER)[1] ?? "";
  const match = after.match(/`?([a-zA-Z0-9_-]+)`?/);
  return match ? match[1] : null;
}

/**
 * Run a startup reconciliation pass:
 * - Fetch all In Progress tickets in the Friday Linear team.
 * - For each ticket with a Friday-bead back-reference comment, check whether
 *   a live Builder is registered for that bead.
 * - Surface orphans (Linear says In Progress, no live Builder) as a Slack
 *   message to the orchestrator channel. Does NOT auto-respawn — the user
 *   decides whether to resume, mark blocked, or cancel.
 *
 * Skips silently when LINEAR_API_KEY is unset (Linear features are disabled).
 */
export async function reconcileLinearTickets(opts: ReconcileOptions): Promise<void> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return;

  const query = `
    query InProgressFridayTickets($teamId: String!) {
      issues(
        first: 100
        filter: {
          team: { id: { eq: $teamId } }
          state: { type: { eq: "started" } }
        }
      ) {
        nodes {
          id
          identifier
          title
          url
          state { name }
          comments(first: 50) {
            nodes { body }
          }
        }
      }
    }
  `;

  let data: { issues?: { nodes: LinearIssueLite[] } };
  try {
    data = await linearGraphQL<{ issues?: { nodes: LinearIssueLite[] } }>(
      apiKey,
      query,
      { teamId: FRIDAY_TEAM_ID }
    );
  } catch (err) {
    log("warn", "linear_reconcile_query_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const issues = data.issues?.nodes ?? [];
  // Restrict to "In Progress" by name (Linear's `started` type also covers
  // user-defined started states like "Ready for Review").
  const inProgress = issues.filter((i) => i.state.name === "In Progress");

  const liveBuilderEpics = new Set(
    listAgents({ type: "builder", status: "active" })
      .map(({ entry }) => (entry.type === "builder" ? entry.epicId : null))
      .filter((id): id is string => Boolean(id))
  );

  const orphans: Array<{ identifier: string; url: string; title: string; beadId: string }> = [];
  for (const issue of inProgress) {
    const beadId = issue.comments.nodes
      .map((c) => extractBeadIdFromComment(c.body))
      .find((id): id is string => Boolean(id));
    if (!beadId) continue; // No bead back-reference — manually-set status, not Friday-managed
    if (liveBuilderEpics.has(beadId)) continue; // Healthy
    orphans.push({
      identifier: issue.identifier,
      url: issue.url,
      title: issue.title,
      beadId,
    });
  }

  log("info", "linear_reconcile_done", {
    inProgress: inProgress.length,
    orphans: orphans.length,
  });

  if (orphans.length === 0) return;

  const lines = orphans.map(
    (o) =>
      `• <${o.url}|${o.identifier}> — *${o.title}* — bead \`${o.beadId}\` has no live builder`
  );
  const message =
    `:eyes: Found ${orphans.length} orphan Linear ticket${orphans.length === 1 ? "" : "s"} after restart:\n` +
    lines.join("\n") +
    `\n\nFor each: resume (re-spawn a builder for the bead), mark blocked, or cancel.`;

  try {
    await opts.postSlack(message);
  } catch (err) {
    log("warn", "linear_reconcile_post_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
