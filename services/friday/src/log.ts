type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

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

  if (level === "error" || level === "fatal") {
    console.error(line);
  } else {
    console.log(line);
  }
}
