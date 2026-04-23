import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { FRIDAY_DIR } from "@friday/shared";

const HEALTH_FILE = join(FRIDAY_DIR, "health.json");

interface HealthStatus {
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  uptimeMs: number;
}

let startedAt: Date;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function writeHealth(): void {
  const now = new Date();
  const status: HealthStatus = {
    pid: process.pid,
    startedAt: startedAt.toISOString(),
    lastHeartbeat: now.toISOString(),
    uptimeMs: now.getTime() - startedAt.getTime(),
  };
  try {
    writeFileSync(HEALTH_FILE, JSON.stringify(status, null, 2));
  } catch {
    // Best-effort — don't crash if we can't write
  }
}

export function startHealthHeartbeat(): void {
  startedAt = new Date();
  writeHealth();
  // Write heartbeat every 30 seconds
  heartbeatInterval = setInterval(writeHealth, 30_000);
  // Don't keep the process alive just for heartbeats
  heartbeatInterval.unref();
}

export function stopHealthHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  // Remove health file on clean shutdown
  try {
    unlinkSync(HEALTH_FILE);
  } catch {
    // Already gone or never written
  }
}
