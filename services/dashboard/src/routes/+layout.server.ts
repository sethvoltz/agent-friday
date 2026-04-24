import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, CONFIG_PATH, FRIDAY_DIR } from "@friday/shared";

const HEALTH_FILE = join(FRIDAY_DIR, "health.json");

interface HealthData {
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  uptimeMs: number;
}

export const load = async () => {
  const config = loadConfig();
  const configExists = existsSync(CONFIG_PATH);

  // Health
  let health: HealthData | null = null;
  let daemonOnline = false;
  let eventServerPort = config.eventServer.port;

  if (existsSync(HEALTH_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(HEALTH_FILE, "utf-8"));
      health = raw;
      if (health) {
        const age = Date.now() - new Date(health.lastHeartbeat).getTime();
        daemonOnline = age < 60_000;
        if (raw.eventServerPort) {
          eventServerPort = raw.eventServerPort;
        }
      }
    } catch {
      // Malformed
    }
  }

  return {
    eventServerUrl: `http://localhost:${eventServerPort}/events`,
    health,
    daemonOnline,
    configExists,
  };
};
