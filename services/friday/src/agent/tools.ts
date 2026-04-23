import {
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WebClient } from "@slack/web-api";

/**
 * Creates MCP tools that give the agent proactive access to Slack.
 * These are injected into the Agent SDK session via mcpServers config.
 */
export function createSlackTools(client: WebClient) {
  return createSdkMcpServer({
    name: "friday-slack",
    tools: [
      tool(
        "slack_reply",
        "Post a message to the current Slack channel. Use this to send status updates, " +
          "progress reports, or intermediate results proactively — without waiting for " +
          "the turn to complete. Each call posts a separate message.",
        {
          text: z.string().describe("The message text to post (supports Slack mrkdwn formatting)"),
          channel_id: z.string().describe("The Slack channel ID to post to"),
        },
        async (args) => {
          try {
            await client.chat.postMessage({
              channel: args.channel_id,
              text: args.text,
            });
            return {
              content: [{ type: "text" as const, text: "Message posted." }],
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            return {
              content: [{ type: "text" as const, text: `Failed to post: ${msg}` }],
              isError: true,
            };
          }
        }
      ),
    ],
  });
}
