import { openSync, writeSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DAEMON_LOG_PATH } from "@friday/shared";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

// Open the log file once at module load (append mode, created if missing)
mkdirSync(dirname(DAEMON_LOG_PATH), { recursive: true });
const logFd = openSync(DAEMON_LOG_PATH, "a");

export function log(
  level: LogLevel,
  event: string,
  data: Record<string, unknown>
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  const line = JSON.stringify(entry);

  // Write to file
  writeSync(logFd, line + "\n");

  // Tee to console
  if (level === "error" || level === "fatal") {
    console.error(line);
  } else {
    console.log(line);
  }
}
