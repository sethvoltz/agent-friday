import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  listProposals,
  getProposal,
  applyProposal,
  rejectProposal,
  type Proposal,
  type ProposalStatus,
} from "@friday/evolve";

export interface EvolveToolsContext {
  /** Name of the agent that owns this MCP server (orchestrator, scheduled-meta-*, etc.) */
  callerName: string;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

function summarize(p: Proposal): string {
  const cluster = p.clusterId ? ` cluster=${p.clusterId}` : "";
  const signalKeys = p.signals.map((s) => s.key).join(",") || "(none)";
  return `[${p.status}] (${p.score}) ${p.id}  —  ${p.title}\n  type=${p.type} signals=${signalKeys}${cluster}`;
}

/**
 * MCP server exposing the evolve backlog to the orchestrator.
 *
 * Phase 2 scope: list, show, approve (memory→materializes), reject, summarize.
 * Approval of prompt/config/code proposals is accepted but materialization is
 * deferred to later phases — `evolve_approve` reports honestly when that happens.
 */
export function createEvolveTools(ctx: EvolveToolsContext) {
  return createSdkMcpServer({
    name: "friday-evolve",
    tools: [
      tool(
        "evolve_list",
        "List self-improvement proposals from the evolve backlog. Use this when the user " +
          "asks 'what improvements?' or 'what's in the backlog?'. Sorted by score, highest first.",
        {
          status: z
            .enum(["open", "critical", "approved", "rejected", "applied", "superseded"])
            .optional()
            .describe("Filter to a single status (default: all)"),
          limit: z.number().optional().default(20).describe("Maximum results (default 20)"),
        },
        async ({ status, limit }) => {
          let all = listProposals();
          if (status) all = all.filter((p) => p.status === (status as ProposalStatus));
          all.sort((a, b) => b.score - a.score);
          const sliced = all.slice(0, limit);

          if (sliced.length === 0) {
            return ok(status ? `No proposals with status "${status}".` : "No proposals.");
          }

          return ok(
            [`${sliced.length} proposal(s):`, "", ...sliced.map(summarize)].join("\n\n")
          );
        }
      ),

      tool(
        "evolve_show",
        "Read the full body of a single proposal — title, frontmatter, signals, and rationale.",
        {
          id: z.string().describe("Proposal id (from evolve_list)"),
        },
        async ({ id }) => {
          const p = getProposal(id);
          if (!p) return err(`Proposal "${id}" not found.`);
          const meta = [
            `id: ${p.id}`,
            `title: ${p.title}`,
            `status: ${p.status}`,
            `score: ${p.score}`,
            `type: ${p.type}`,
            `blastRadius: ${p.blastRadius}`,
            `appliesTo: ${p.appliesTo.join(", ") || "(none)"}`,
            `createdBy: ${p.createdBy}`,
            `createdAt: ${p.createdAt}`,
            `updatedAt: ${p.updatedAt}`,
            p.appliedAt ? `appliedAt: ${p.appliedAt}` : null,
            p.appliedBy ? `appliedBy: ${p.appliedBy}` : null,
          ]
            .filter(Boolean)
            .join("\n");

          const signalLines = p.signals
            .map(
              (s) =>
                `- ${s.key} (${s.severity}, ${s.count}x) hash=${s.hash}` +
                (s.agent ? ` agent=${s.agent}` : "")
            )
            .join("\n");

          return ok(
            [meta, "", "Signals:", signalLines || "(none)", "", "---", "", p.proposedChange].join("\n")
          );
        }
      ),

      tool(
        "evolve_approve",
        "Approve a proposal and apply it. For memory-type proposals, this writes a new entry to " +
          "persistent memory. For prompt/config/code types, the approval is recorded but " +
          "auto-application lands in a later phase — the tool will tell you if that's the case.",
        {
          id: z.string().describe("Proposal id"),
        },
        async ({ id }) => {
          const outcome = await applyProposal(id, { appliedBy: ctx.callerName });
          if (outcome.ok) {
            const linearLine = outcome.ticketUrl
              ? ` Linear: <${outcome.ticketUrl}|${outcome.ticketId}>.`
              : "";
            return ok(
              `Proposal ${id} applied. Materialized as ${outcome.appliedRef}. Status: ${outcome.proposal.status}.${linearLine}`
            );
          }
          // applyProposal returns ok:false both for "queued" (prompt/config/code) and hard errors.
          // Distinguish by reading the proposal back.
          const reloaded = getProposal(id);
          if (reloaded?.status === "approved") {
            return ok(`Proposal ${id} approved (queued — ${outcome.reason}).`);
          }
          return err(outcome.reason);
        }
      ),

      tool(
        "evolve_reject",
        "Reject a proposal — marks it rejected so future scans won't merge new occurrences " +
          "into it. Use when the proposal is noise, already addressed, or otherwise not actionable.",
        {
          id: z.string().describe("Proposal id"),
          reason: z.string().optional().describe("Short reason recorded with the rejection"),
        },
        async ({ id, reason }) => {
          const rejected = rejectProposal(id, { rejectedBy: ctx.callerName, reason });
          if (!rejected) return err(`Proposal "${id}" not found.`);
          return ok(`Proposal ${id} rejected.${reason ? ` Reason: ${reason}` : ""}`);
        }
      ),

      tool(
        "evolve_summarize_critical",
        "Return a terse digest of every proposal currently at status=critical. Use this when " +
          "the user asks for an overview of urgent items, or after receiving urgent mail from " +
          "the meta-agent.",
        {},
        async () => {
          const critical = listProposals()
            .filter((p) => p.status === "critical")
            .sort((a, b) => b.score - a.score);

          if (critical.length === 0) return ok("No critical proposals.");

          const lines = critical.map(
            (p) =>
              `• *${p.title}* (score ${p.score}, type ${p.type}) — id \`${p.id}\`\n  ${p.signals
                .map((s) => `${s.key}×${s.count}`)
                .join(", ")}`
          );

          return ok(
            [`${critical.length} critical proposal(s):`, "", ...lines].join("\n")
          );
        }
      ),
    ],
  });
}
