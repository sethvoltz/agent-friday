import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WebClient } from "@slack/web-api";
import { getAgent } from "../sessions/registry.js";
import {
  connect,
  disconnect,
  getByAgent,
  getByThread,
} from "./thread-registry.js";
import { addReaction, removeReaction } from "./helpers.js";
import { notifyThreadConnect, notifyThreadDisconnect } from "../agent/lifecycle.js";
import { log } from "../log.js";

/**
 * Creates the friday-threads MCP server — orchestrator-only.
 * Provides thread_connect and thread_disconnect tools for bidirectional
 * Slack thread ↔ agent linking.
 */
export function createThreadTools(client: WebClient) {
  return createSdkMcpServer({
    name: "friday-threads",
    tools: [
      tool(
        "thread_connect",
        "Connect a Slack thread directly to a running Builder or Helper agent for " +
          "bidirectional communication. The user's messages in that thread are forwarded " +
          "to the agent as mail, and the agent can reply directly via slack_reply. " +
          "An agent can only be connected to one thread; a thread to one agent.",
        {
          agent_name: z.string().describe("Name of the Builder or Helper agent to connect"),
          channel_id: z.string().describe("Slack channel ID containing the thread"),
          thread_ts: z.string().describe("Timestamp of the root thread message"),
          anchor_ts: z
            .string()
            .describe(
              "Timestamp of the message where the :link: reaction will be placed " +
                "(usually the same as thread_ts)."
            ),
        },
        async (args) => {
          const { agent_name, channel_id, thread_ts, anchor_ts } = args;

          // Validate agent exists
          const entry = getAgent(agent_name);
          if (!entry) {
            return {
              content: [{ type: "text" as const, text: `Error: agent "${agent_name}" not found.` }],
              isError: true,
            };
          }
          if (entry.status === "destroyed") {
            return {
              content: [{ type: "text" as const, text: `Error: agent "${agent_name}" is destroyed.` }],
              isError: true,
            };
          }

          // Handle stolen-connection case: if thread is already owned by a different agent,
          // refuse — caller must explicitly disconnect the current owner first.
          const existingOwner = getByThread(thread_ts);
          if (existingOwner && existingOwner.agentName !== agent_name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `Error: thread is already connected to agent "${existingOwner.agentName}". ` +
                    `Disconnect it with thread_disconnect first.`,
                },
              ],
              isError: true,
            };
          }

          // Connect (handles agent-stolen case internally — old thread gets disconnect)
          const result = connect(agent_name, channel_id, thread_ts);
          if (!result.ok) {
            return {
              content: [{ type: "text" as const, text: `Error: ${result.error}` }],
              isError: true,
            };
          }

          // If the agent was stolen from a previous thread, notify the old thread
          if (result.stolen) {
            const old = result.stolen;
            const slackLink = `https://slack.com/archives/${old.channelId}/p${old.threadTs.replace(".", "")}`;
            await client.chat.postMessage({
              channel: old.channelId,
              text: `Disconnected — agent connected to new thread: ${slackLink}`,
              thread_ts: old.threadTs,
            }).catch(() => {});
            await removeReaction(client, old.channelId, old.threadTs, "link");
            notifyThreadDisconnect(agent_name, "stolen");
          }

          // Add :link: reaction to anchor message
          await addReaction(client, channel_id, anchor_ts, "link");

          // Post confirmation in thread
          await client.chat.postMessage({
            channel: channel_id,
            text: `Connected to \`${agent_name}\`. Messages you send here go directly to the agent.`,
            thread_ts,
          }).catch(() => {});

          // Notify agent
          notifyThreadConnect(agent_name, channel_id, thread_ts);

          log("info", "thread_connect_tool", { agentName: agent_name, channelId: channel_id, threadTs: thread_ts });

          return {
            content: [
              {
                type: "text" as const,
                text: `Connected. Thread ${thread_ts} in ${channel_id} is now linked to ${agent_name}.`,
              },
            ],
          };
        }
      ),

      tool(
        "thread_disconnect",
        "Disconnect a Builder or Helper agent from its connected Slack thread. " +
          "Removes the :link: reaction, posts a disconnect notice in the thread, " +
          "and notifies the agent.",
        {
          agent_name: z.string().describe("Name of the agent to disconnect"),
        },
        async (args) => {
          const { agent_name } = args;

          const conn = getByAgent(agent_name);
          if (!conn) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: agent "${agent_name}" is not connected to any thread.`,
                },
              ],
              isError: true,
            };
          }

          const result = disconnect(agent_name, "manual");
          if (!result) {
            return {
              content: [{ type: "text" as const, text: `Error: disconnect failed for "${agent_name}".` }],
              isError: true,
            };
          }

          // Post disconnect notice in thread
          await client.chat.postMessage({
            channel: result.channelId,
            text: "Disconnected.",
            thread_ts: result.threadTs,
          }).catch(() => {});

          // Remove :link: reaction
          await removeReaction(client, result.channelId, result.threadTs, "link");

          // Notify agent
          notifyThreadDisconnect(agent_name, "manual");

          log("info", "thread_disconnect_tool", { agentName: agent_name });

          return {
            content: [
              {
                type: "text" as const,
                text: `Disconnected agent "${agent_name}" from thread ${result.threadTs}.`,
              },
            ],
          };
        }
      ),
    ],
  });
}
