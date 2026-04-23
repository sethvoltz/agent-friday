import { loadRuntimeConfig } from "./config.js";
import { createSlackApp } from "./slack/app.js";
import { registerEventHandlers } from "./slack/events.js";
import { loadSessions } from "./sessions/manager.js";

async function main() {
  console.log("Friday starting...");

  const config = loadRuntimeConfig();
  loadSessions();
  console.log(
    `Orchestrator channel: ${config.slack.orchestratorChannelId}`
  );
  console.log(`Working directory: ${config.agent.workingDirectory}`);

  const app = createSlackApp(config);
  registerEventHandlers(app, config);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    try {
      await app.stop();
    } catch {
      // Ignore stop errors during shutdown
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await app.start();
  console.log("Friday is running. Listening for messages...");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
