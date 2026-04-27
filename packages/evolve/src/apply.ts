import { saveEntry } from "@friday/memory";
import { getProposal, updateProposal, type Proposal } from "./store.js";

export type ApplyOutcome =
  | { ok: true; proposal: Proposal; appliedRef: string }
  | { ok: false; reason: string };

export interface ApplyOptions {
  /** Identifier of who's applying — "orchestrator", "dashboard", "cli", etc. */
  appliedBy: string;
}

/**
 * Apply an approved proposal to the system. Phase 2 wires only `memory`
 * proposals through to `@friday/memory.saveEntry`. Other types are accepted
 * (status moves to `approved`) but materialization is deferred to later phases:
 *   - prompt/config → Phase 3 (in-process config writer)
 *   - code         → Phase 5 (Beads epic dispatch)
 *
 * The caller decides whether "approved-but-not-applied" is acceptable; this
 * function is honest about which proposals end up fully applied vs. queued.
 */
export function applyProposal(id: string, opts: ApplyOptions): ApplyOutcome {
  const proposal = getProposal(id);
  if (!proposal) return { ok: false, reason: `proposal not found: ${id}` };
  if (proposal.status === "applied") {
    return { ok: false, reason: `proposal already applied: ${id}` };
  }
  if (proposal.status === "rejected") {
    return { ok: false, reason: `proposal was rejected: ${id}` };
  }

  if (proposal.type === "memory") {
    const entry = saveEntry({
      title: proposal.title,
      content: buildMemoryBody(proposal),
      tags: ["evolve", ...proposal.appliesTo],
      createdBy: opts.appliedBy,
    });
    const updated = updateProposal(id, {
      status: "applied",
      appliedAt: new Date().toISOString(),
      appliedBy: opts.appliedBy,
    });
    return { ok: true, proposal: updated ?? proposal, appliedRef: `memory:${entry.id}` };
  }

  // Phase 2: accept the approval but mark it as queued — don't pretend we applied
  // a config/prompt/code change we haven't wired up yet.
  const updated = updateProposal(id, {
    status: "approved",
    appliedAt: null,
    appliedBy: opts.appliedBy,
  });
  return {
    ok: false,
    reason: `auto-apply for type "${proposal.type}" lands in a later phase; proposal marked approved (id ${updated?.id ?? id})`,
  };
}

/**
 * Mark a proposal rejected with an optional reason recorded in appliedBy.
 * Rejection is terminal — the next scan won't merge new occurrences into it
 * because findProposalBySignalHash skips rejected proposals.
 */
export function rejectProposal(id: string, opts: { rejectedBy: string; reason?: string }): Proposal | null {
  const proposal = getProposal(id);
  if (!proposal) return null;
  if (proposal.status === "rejected") return proposal;

  return updateProposal(id, {
    status: "rejected",
    appliedAt: new Date().toISOString(),
    appliedBy: opts.reason ? `${opts.rejectedBy}: ${opts.reason}` : opts.rejectedBy,
  });
}

function buildMemoryBody(proposal: Proposal): string {
  const signalLines = proposal.signals
    .map((s) => {
      const agent = s.agent ? ` agent=${s.agent}` : "";
      return `- ${s.key}${agent} (${s.count}x, severity=${s.severity})`;
    })
    .join("\n");

  return [
    proposal.proposedChange.trim(),
    "",
    "---",
    `Recorded from evolve proposal \`${proposal.id}\`.`,
    "Signals:",
    signalLines,
  ].join("\n");
}
