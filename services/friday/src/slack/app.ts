import { App } from "@slack/bolt";
import type { RuntimeConfig } from "../config.js";

export function createSlackApp(config: RuntimeConfig): App {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });

  return app;
}
