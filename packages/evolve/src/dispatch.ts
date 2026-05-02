import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BEADS_DIR,
  EVOLVE_LABEL,
  EVOLVE_NOTIFICATION_SCORE_THRESHOLD,
  FRIDAY_TEAM_ID,
} from "@friday/shared";
import type { Proposal } from "./store.js";

export interface DispatchResult {
  /** Linear ticket identifier (e.g. "FRI-99") seeded with the proposal body. */
  ticketId: string;
  /** Linear ticket URL. */
  ticketUrl: string;
  /**
   * Beads issue id of the orchestrator notification mail. Undefined when
   * the proposal scored below {@link EVOLVE_NOTIFICATION_SCORE_THRESHOLD}
   * and is not `critical` — those land silently in Linear Backlog and wait
   * for human triage.
   */
  mailId?: string;
}

export interface DispatchOptions {
  /** Override BEADS_DIR — used by tests. */
  workspace?: string;
  /** Inject a custom bd command runner — used by tests to avoid spawning bd. */
  runBd?: (args: string[]) => string;
  /**
   * Inject a custom Linear ticket creator — used by tests to avoid hitting
   * the real Linear API. Returns the created ticket's identifier and URL.
   */
  createLinearTicket?: (input: CreateLinearTicketInput) => Promise<{
    identifier: string;
    url: string;
  }>;
  /** Identifier of who's dispatching (becomes the from: label on the mail). */
  appliedBy: string;
}

export interface CreateLinearTicketInput {
  teamId: string;
  title: string;
  description: string;
  /** Linear priority: 1=Urgent, 2=High, 3=Normal, 4=Low. */
  priority: number;
  /** Label names; missing labels are auto-created on the team. */
  labels: string[];
}

/**
 * Phase 5: materialize a `code` proposal.
 *
 * Files a Linear ticket in the Friday team's Backlog with the proposal body
 * + evidence pointers, mapped priority, and the `evolve` label. For
 * high-signal proposals (score ≥ {@link EVOLVE_NOTIFICATION_SCORE_THRESHOLD}
 * or `status === "critical"`) also mails the orchestrator so it can surface
 * the ticket in Slack with a "Promote to Todo?" prompt. Lower-signal
 * proposals land silently and wait for human triage in Linear.
 *
 * The mail label format mirrors `services/friday/src/comms/mail.ts` so the
 * orchestrator's existing mail poller picks it up unchanged.
 */
export async function dispatchCodeProposal(
  proposal: Proposal,
  opts: DispatchOptions
): Promise<DispatchResult> {
  const create = opts.createLinearTicket ?? defaultLinearCreator;
  const priority = mapScoreToPriority(proposal);
  const { identifier: ticketId, url: ticketUrl } = await create({
    teamId: FRIDAY_TEAM_ID,
    title: `Evolve: ${proposal.title}`,
    description: buildTicketBody(proposal),
    priority,
    labels: [EVOLVE_LABEL],
  });

  const isHighSignal =
    proposal.status === "critical" ||
    proposal.score >= EVOLVE_NOTIFICATION_SCORE_THRESHOLD;

  if (!isHighSignal) {
    return { ticketId, ticketUrl };
  }

  const workspace = opts.workspace ?? BEADS_DIR;
  const bd = opts.runBd ?? defaultRunner(workspace);
  const mailId = bd([
    "create",
    `Evolve filed ${ticketId} (${priorityLabel(priority)})`,
    "-d",
    buildMailBody(proposal, ticketId, ticketUrl, priority),
    "-a",
    "orchestrator",
    "-l",
    `type:message,delivery:pending,from:evolve:${opts.appliedBy}`,
    "--priority",
    "2",
    "--ephemeral",
    "--silent",
  ]);

  return { ticketId, ticketUrl, mailId };
}

/** Map proposal score (and `critical` flag) to Linear priority. */
export function mapScoreToPriority(proposal: Proposal): number {
  if (proposal.status === "critical" || proposal.score >= 80) return 1; // Urgent
  if (proposal.score >= 60) return 2; // High
  if (proposal.score >= 40) return 3; // Normal
  return 4; // Low
}

function priorityLabel(p: number): string {
  return ["None", "Urgent", "High", "Normal", "Low"][p] ?? "Normal";
}

function defaultRunner(workspace: string): (args: string[]) => string {
  return (args) => {
    if (!existsSync(join(workspace, ".beads"))) {
      throw new Error(
        `Beads database not found at ${workspace}. Run: cd ${workspace} && bd init --non-interactive --prefix friday --skip-agents --skip-hooks`
      );
    }
    const result = execFileSync("bd", args, {
      cwd: workspace,
      stdio: "pipe",
      env: { ...process.env, BD_NON_INTERACTIVE: "1" },
    });
    return result.toString().trim();
  };
}

/**
 * Default Linear ticket creator: hits the Linear GraphQL API directly with
 * `LINEAR_API_KEY` from env. Resolves label names to IDs (creating any that
 * don't exist on the team) and the Backlog state ID, then fires `issueCreate`.
 *
 * Fails loudly if `LINEAR_API_KEY` is unset — evolve dispatch *requires*
 * Linear since the cutover. If you need to disable Linear writes, don't run
 * `friday evolve apply` until the key is set.
 */
async function defaultLinearCreator(
  input: CreateLinearTicketInput
): Promise<{ identifier: string; url: string }> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LINEAR_API_KEY not set — evolve dispatch requires Linear. Run `friday setup linear`."
    );
  }

  const stateId = await resolveBacklogStateId(apiKey, input.teamId);
  const labelIds = await resolveLabelIds(apiKey, input.teamId, input.labels);

  const mutation = `
    mutation CreateEvolveTicket(
      $teamId: String!
      $title: String!
      $description: String!
      $stateId: String!
      $priority: Int!
      $labelIds: [String!]!
    ) {
      issueCreate(input: {
        teamId: $teamId
        title: $title
        description: $description
        stateId: $stateId
        priority: $priority
        labelIds: $labelIds
      }) {
        success
        issue { identifier url }
      }
    }
  `;

  const data = await linearGraphQL<{ issueCreate: { success: boolean; issue: { identifier: string; url: string } | null } }>(
    apiKey,
    mutation,
    {
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      stateId,
      priority: input.priority,
      labelIds,
    }
  );

  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error(`Linear issueCreate returned success=false`);
  }
  return {
    identifier: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
  };
}

async function resolveBacklogStateId(apiKey: string, teamId: string): Promise<string> {
  const query = `
    query BacklogState($teamId: String!) {
      workflowStates(filter: { team: { id: { eq: $teamId } }, name: { eq: "Backlog" } }) {
        nodes { id name }
      }
    }
  `;
  const data = await linearGraphQL<{ workflowStates: { nodes: Array<{ id: string }> } }>(
    apiKey,
    query,
    { teamId }
  );
  const state = data.workflowStates.nodes[0];
  if (!state) {
    throw new Error(`No "Backlog" workflow state found for team ${teamId}`);
  }
  return state.id;
}

async function resolveLabelIds(
  apiKey: string,
  teamId: string,
  names: string[]
): Promise<string[]> {
  if (names.length === 0) return [];
  const query = `
    query LabelsByTeam($teamId: String!) {
      issueLabels(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name }
      }
    }
  `;
  const data = await linearGraphQL<{ issueLabels: { nodes: Array<{ id: string; name: string }> } }>(
    apiKey,
    query,
    { teamId }
  );
  const existing = new Map(data.issueLabels.nodes.map((l) => [l.name, l.id]));

  const ids: string[] = [];
  for (const name of names) {
    const cached = existing.get(name);
    if (cached) {
      ids.push(cached);
      continue;
    }
    // Auto-create missing label scoped to the team.
    const mutation = `
      mutation CreateLabel($teamId: String!, $name: String!) {
        issueLabelCreate(input: { teamId: $teamId, name: $name }) {
          success
          issueLabel { id }
        }
      }
    `;
    const created = await linearGraphQL<{ issueLabelCreate: { success: boolean; issueLabel: { id: string } | null } }>(
      apiKey,
      mutation,
      { teamId, name }
    );
    if (!created.issueLabelCreate.success || !created.issueLabelCreate.issueLabel) {
      throw new Error(`Failed to auto-create Linear label "${name}"`);
    }
    ids.push(created.issueLabelCreate.issueLabel.id);
  }
  return ids;
}

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

function buildTicketBody(proposal: Proposal): string {
  const evidence = proposal.signals.flatMap((s) =>
    s.evidencePointers.map((ev) => {
      const loc = ev.line ? `:${ev.line}` : "";
      const sess = ev.sessionId ? ` (session ${ev.sessionId})` : "";
      return `- \`${ev.kind}\` ${ev.path}${loc}${sess}`;
    })
  );

  const targets = proposal.appliesTo.length
    ? proposal.appliesTo.map((t) => `\`${t}\``).join(", ")
    : "(none specified)";

  return [
    `Source: evolve proposal \`${proposal.id}\` (score ${proposal.score}, blast ${proposal.blastRadius}).`,
    "",
    "## Proposed change",
    "",
    proposal.proposedChange.trim(),
    "",
    "## Targets",
    "",
    targets,
    "",
    "## Evidence",
    "",
    evidence.length > 0 ? evidence.join("\n") : "(no evidence pointers attached)",
    "",
    "## Acceptance criteria",
    "",
    "- Implement the change above with tests covering the failure modes the signals describe.",
    "- Verify pre-push gates pass (pnpm test, daemon tsc, cli tsc, shared build).",
  ].join("\n");
}

function buildMailBody(
  proposal: Proposal,
  ticketId: string,
  ticketUrl: string,
  priority: number
): string {
  // Top 1–2 signal pointers for the verbose Slack message the orchestrator
  // will render. The full evidence list lives in the Linear ticket body.
  const topSignals = proposal.signals.slice(0, 2).flatMap((s) =>
    s.evidencePointers.slice(0, 1).map((ev) => {
      const loc = ev.line ? `:${ev.line}` : "";
      return `\`${ev.kind}\` ${ev.path}${loc}`;
    })
  );
  const signalLines = topSignals.length > 0 ? topSignals.join(", ") : "(see ticket)";

  return [
    `:sparkles: Evolve filed <${ticketUrl}|${ticketId}> (${priorityLabel(priority)}): ${proposal.title}`,
    "",
    proposal.proposedChange.trim().split("\n").slice(0, 2).join(" ").slice(0, 240),
    "",
    `Top signals: ${signalLines}`,
    `Score: ${proposal.score} · Blast: ${proposal.blastRadius} · Proposal: \`${proposal.id}\``,
    "",
    "Promote to Todo?",
  ].join("\n");
}
