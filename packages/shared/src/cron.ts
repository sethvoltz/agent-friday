import { CronExpressionParser } from "cron-parser";

/**
 * Validate a 5-field cron string (and optional timezone).
 * Returns null on success, or a human-readable error message.
 */
export function validateCron(cron: string, timezone?: string): string | null {
  try {
    CronExpressionParser.parse(cron, { tz: timezone });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Validate an ISO 8601 timestamp.
 * Returns null on success, or a human-readable error message.
 */
export function validateRunAt(runAt: string): string | null {
  const t = Date.parse(runAt);
  if (Number.isNaN(t)) return `not a valid ISO 8601 timestamp: ${JSON.stringify(runAt)}`;
  return null;
}
