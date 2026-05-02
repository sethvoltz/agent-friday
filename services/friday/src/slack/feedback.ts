import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { FEEDBACK_LOG_PATH } from "@friday/shared";

export type FeedbackKind = "edited" | "deleted";

export interface FeedbackRecord {
  ts: string;
  kind: FeedbackKind;
  channelId: string;
  messageTs: string;
  /** Original text (deleted) or pre-edit text (edited). May be undefined when Slack omits it. */
  previousText?: string;
  /** Post-edit text (edited only). */
  newText?: string;
  /** Set when the affected message belonged to an in-flight Friday turn. */
  agent?: string;
  /** Set when the affected message belonged to a tracked Friday session. */
  sessionId?: string;
}

export function logFeedback(record: Omit<FeedbackRecord, "ts">): void {
  const line: FeedbackRecord = { ts: new Date().toISOString(), ...record };
  mkdirSync(dirname(FEEDBACK_LOG_PATH), { recursive: true });
  appendFileSync(FEEDBACK_LOG_PATH, JSON.stringify(line) + "\n");
}

export { FEEDBACK_LOG_PATH };
