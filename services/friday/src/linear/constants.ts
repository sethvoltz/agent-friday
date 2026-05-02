/**
 * Re-export Linear constants from `@friday/shared` so daemon code, evolve,
 * and any future package can pull from a single source of truth.
 */
export {
  FRIDAY_TEAM_ID,
  FRIDAY_TEAM_NAME,
  EVOLVE_LABEL,
  FRIDAY_BEAD_MARKER,
  LINEAR_MCP_NAME,
  LINEAR_MCP_PACKAGE,
  EVOLVE_NOTIFICATION_SCORE_THRESHOLD,
} from "@friday/shared";
