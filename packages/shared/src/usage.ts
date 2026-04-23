export interface UsageEntry {
  timestamp: string;
  channelId: string;
  sessionType: "orchestrator" | "independent";
  sessionId: string;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnNumber: number;
  durationMs: number;
}
