import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSessionId, setSessionId } from "../sessions/manager.js";

export interface AgentOptions {
  channelId: string;
  isOrchestrator: boolean;
  workingDirectory: string;
  allowedTools: string[];
  model: string;
}

export async function sendToAgent(
  prompt: string,
  options: AgentOptions
): Promise<string> {
  let responseText = "";

  // Resume existing session for this channel, or start fresh
  const existingSessionId = getSessionId(options.channelId);

  const queryOptions: Record<string, any> = {
    allowedTools: options.allowedTools,
    cwd: options.workingDirectory,
    model: options.model,
    permissionMode: "bypassPermissions",
  };

  if (existingSessionId) {
    queryOptions.resume = existingSessionId;
  }

  for await (const message of query({
    prompt,
    options: queryOptions,
  })) {
    if (message.type === "assistant") {
      const text = message.message.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
      responseText += text;
    }

    if (message.type === "result") {
      if (message.subtype !== "success") {
        throw new Error(`Agent ended with status: ${message.subtype}`);
      }

      // Track session for this channel
      setSessionId(options.channelId, message.session_id);

      // Log usage for monitoring
      const usage = (message as any).usage;
      if (usage) {
        console.log(
          JSON.stringify({
            event: "agent_response",
            channelId: options.channelId,
            sessionType: options.isOrchestrator
              ? "orchestrator"
              : "independent",
            sessionId: message.session_id,
            costUsd: (message as any).total_cost_usd ?? null,
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          })
        );
      }
    }
  }

  return responseText || "(No response from agent)";
}
