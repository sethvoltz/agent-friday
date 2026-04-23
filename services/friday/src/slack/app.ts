import { App, LogLevel } from "@slack/bolt";
import type { RuntimeConfig } from "../config.js";
import { log } from "../log.js";

export function createSlackApp(config: RuntimeConfig): App {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: LogLevel.WARN, // Reduce Bolt's built-in logging noise
  });

  // Log global errors from Bolt
  app.error(async (error) => {
    log("error", "slack_app_error", {
      error: error.message ?? String(error),
    });
  });

  return app;
}
