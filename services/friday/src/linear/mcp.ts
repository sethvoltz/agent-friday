import type { McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { LINEAR_MCP_PACKAGE } from "./constants.js";

/**
 * Build the stdio MCP server config that exposes Linear tools to Friday's
 * agents. Returns `null` when `LINEAR_API_KEY` is not set so callers can
 * conditionally include it in their `mcpServers` map without registering a
 * non-functional server.
 *
 * The spawned child inherits the parent process env (including `LINEAR_API_KEY`
 * loaded from `~/.friday/.env`) — we don't override `env` because stripping
 * it would also strip `PATH`, `HOME`, etc. that `npx` needs.
 */
export function buildLinearMcpServer(): McpStdioServerConfig | null {
  if (!process.env.LINEAR_API_KEY) return null;
  return {
    type: "stdio",
    command: "npx",
    args: ["-y", LINEAR_MCP_PACKAGE],
  };
}
