import type { SessionType } from "./agents.js";

export interface UsageEntry {
  timestamp: string;
  channelId: string;
  sessionType: SessionType;
  sessionId: string;
  model?: string;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnNumber: number;
  durationMs: number;
}
