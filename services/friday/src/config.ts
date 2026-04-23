import { config as loadDotenv } from "dotenv";
import { loadConfig, ENV_PATH, type FridayConfig } from "@friday/shared";

export interface RuntimeConfig extends FridayConfig {
  slackAppToken: string;
  slackBotToken: string;
}

export function loadRuntimeConfig(): RuntimeConfig {
  // Load secrets from ~/.friday/.env
  loadDotenv({ path: ENV_PATH });

  const slackAppToken = process.env.SLACK_APP_TOKEN;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;

  if (!slackAppToken || !slackBotToken) {
    console.error(
      "Missing SLACK_APP_TOKEN or SLACK_BOT_TOKEN.\n" +
        "Set them in ~/.friday/.env or as environment variables.\n" +
        "See: https://api.slack.com/apps"
    );
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.slack.orchestratorChannelId) {
    console.error(
      "Missing slack.orchestratorChannelId in ~/.friday/config.json.\n" +
        "Set it to the channel ID where the orchestrator should listen."
    );
    process.exit(1);
  }

  return {
    ...config,
    slackAppToken,
    slackBotToken,
  };
}
