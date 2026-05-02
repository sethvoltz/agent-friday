/**
 * Friday's Linear workspace identifiers.
 *
 * Friday is the team that owns Friday's own backlog (the meta-task tracker
 * for Friday itself). All tickets created/managed by Friday's agents live
 * here; evolve dispatches land here in Backlog.
 */
export const FRIDAY_TEAM_ID = "3bab6974-5623-4a9f-a163-e45b2cd02a35";
export const FRIDAY_TEAM_NAME = "Friday";

/** Label applied to every ticket created by `friday evolve` dispatch. */
export const EVOLVE_LABEL = "evolve";

/**
 * Marker prefix used in Linear comments to back-link a ticket to its local
 * Beads epic shim. Reconciliation searches comments for this prefix to map
 * Linear → Beads.
 *
 * Example comment body: `🔗 Friday bead: \`abc123-def-456\``
 */
export const FRIDAY_BEAD_MARKER = "🔗 Friday bead:";

/** Linear MCP server name used in agent-side `mcpServers` configs. */
export const LINEAR_MCP_NAME = "linear";

/** Pinned version of the third-party Linear MCP package. */
export const LINEAR_MCP_PACKAGE = "@tacticlaunch/mcp-linear@1.0.14";

/**
 * Tiered notification threshold: evolve only mails the orchestrator when
 * a proposal scores at or above this, or has `status === "critical"`.
 * Lower-signal proposals land in Linear Backlog silently and wait for human
 * triage.
 */
export const EVOLVE_NOTIFICATION_SCORE_THRESHOLD = 80;
