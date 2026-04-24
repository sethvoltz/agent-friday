import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { mailSend, mailCheck, mailRead, mailClose } from "./mail.js";

export interface MailToolsContext {
  /** Name of the agent that owns this MCP server */
  callerName: string;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Create an MCP server with mail tools for inter-agent communication.
 *
 * All agent types get mail tools. The caller's name is automatically
 * set as the sender for outgoing mail.
 */
export function createMailTools(ctx: MailToolsContext) {
  return createSdkMcpServer({
    name: "friday-mail",
    tools: [
      tool(
        "mail_send",
        "Send a message to another agent. Messages are async — the recipient will see it on their next turn.",
        {
          to: z.string().describe("Recipient agent name (e.g. 'orchestrator', 'builder-blog')"),
          subject: z.string().describe("Short subject line"),
          body: z.string().describe("Message body"),
          priority: z
            .enum(["normal", "urgent"])
            .optional()
            .default("normal")
            .describe("Priority level. Use 'urgent' sparingly — it bumps the message to the front of the queue."),
        },
        async ({ to, subject, body, priority }) => {
          const id = mailSend({
            from: ctx.callerName,
            to,
            subject,
            body,
            priority,
          });
          return ok(`Message sent to ${to} (id: ${id})`);
        }
      ),

      tool(
        "mail_check",
        "Check your inbox for pending messages. Returns a list of unread messages with sender, subject, and priority.",
        {},
        async () => {
          const messages = mailCheck(ctx.callerName);
          if (messages.length === 0) {
            return ok("No pending messages.");
          }
          const lines = messages.map((m) => {
            const urgent = m.priority === "urgent" ? " [URGENT]" : "";
            return `- ${m.id}: from=${m.from} subject="${m.subject}"${urgent}`;
          });
          return ok(`${messages.length} pending message(s):\n${lines.join("\n")}`);
        }
      ),

      tool(
        "mail_read",
        "Read a specific message by ID. Marks the message as acknowledged.",
        {
          id: z.string().describe("Message ID (e.g. 'friday-a3f2dd')"),
        },
        async ({ id }) => {
          const msg = mailRead(id);
          return ok([
            `From: ${msg.from}`,
            `To: ${msg.to}`,
            `Subject: ${msg.subject}`,
            `Priority: ${msg.priority}`,
            `Status: ${msg.status}`,
            `Date: ${msg.createdAt}`,
            "",
            msg.body,
          ].join("\n"));
        }
      ),

      tool(
        "mail_close",
        "Close a message after you've processed it. Keeps the inbox clean.",
        {
          id: z.string().describe("Message ID to close"),
        },
        async ({ id }) => {
          mailClose(id);
          return ok(`Message ${id} closed.`);
        }
      ),
    ],
  });
}
