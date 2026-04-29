/** Last crash diagnostics keyed by agent name. Set by lifecycle, read by health monitor. */
const store = new Map<string, { exitCode: number | null; stderrTail: string }>();

export function setCrashInfo(
  agentName: string,
  info: { exitCode: number | null; stderrTail: string }
): void {
  store.set(agentName, info);
}

export function getCrashInfo(
  agentName: string
): { exitCode: number | null; stderrTail: string } | null {
  return store.get(agentName) ?? null;
}

export function clearCrashInfo(agentName: string): void {
  store.delete(agentName);
}
