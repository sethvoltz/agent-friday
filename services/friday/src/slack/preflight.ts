import type { WebClient } from "@slack/web-api";
import type { EmojiConfig } from "@friday/shared";
import { log } from "../log.js";

/**
 * Clean up dangling Slack state from a previous crash or restart.
 *
 * Scans recent messages in the orchestrator channel for:
 * - Dangling processing (:eyes:) reactions from the bot — removes them
 * - Incomplete streaming placeholders ("_..._") posted by the bot — deletes them
 *
 * This runs once at boot, before the mail poller or agent restore,
 * so the channel is clean when the orchestrator comes online.
 */
export async function slackPreflight(options: {
  client: WebClient;
  channelId: string;
  emojis: EmojiConfig;
  botUserId: string;
}): Promise<void> {
  const { client, channelId, emojis, botUserId } = options;

  try {
    // Fetch recent messages — 20 is plenty for a crash recovery window
    const history = await client.conversations.history({
      channel: channelId,
      limit: 20,
    });

    if (!history.messages) return;

    let reactionsRemoved = 0;
    let placeholdersPatched = 0;

    for (const msg of history.messages) {
      // Clean dangling processing reactions on user messages
      if (msg.reactions && msg.ts) {
        const hasProcessing = msg.reactions.some(
          (r) =>
            r.name === emojis.processing &&
            r.users?.includes(botUserId)
        );
        if (hasProcessing) {
          try {
            await client.reactions.remove({
              channel: channelId,
              timestamp: msg.ts,
              name: emojis.processing,
            });
            reactionsRemoved++;
          } catch {
            // Reaction already removed or message deleted
          }
        }

        const hasQueued = msg.reactions.some(
          (r) =>
            r.name === emojis.queued &&
            r.users?.includes(botUserId)
        );
        if (hasQueued) {
          try {
            await client.reactions.remove({
              channel: channelId,
              timestamp: msg.ts,
              name: emojis.queued,
            });
            reactionsRemoved++;
          } catch {
            // Reaction already removed
          }
        }
      }

      // Patch bot-posted incomplete messages — replace trailing streaming
      // indicators with a connection-lost notice instead of deleting
      if (
        msg.bot_id &&
        msg.user === botUserId &&
        msg.ts &&
        msg.text
      ) {
        const text = msg.text.trim();
        const BROKEN = "\n\n_... connection lost (Friday restarted)_";

        let patchedText: string | null = null;
        if (text === "_..._" || text === "_Working..._") {
          // Empty placeholder — replace entirely
          patchedText = "_Response interrupted — Friday restarted before replying._";
        } else if (text.endsWith("_..._")) {
          patchedText = text.slice(0, -"_..._".length).trimEnd() + BROKEN;
        } else if (text.endsWith("_...streaming..._")) {
          patchedText = text.slice(0, -"_...streaming..._".length).trimEnd() + BROKEN;
        } else if (text.endsWith("_Working..._")) {
          patchedText = text.slice(0, -"_Working..._".length).trimEnd() + BROKEN;
        }

        if (patchedText) {
          try {
            await client.chat.update({
              channel: channelId,
              ts: msg.ts,
              text: patchedText,
            });
            placeholdersPatched++;
          } catch {
            // Message already deleted or not editable
          }
        }
      }
    }

    log("info", "slack_preflight_complete", {
      channelId,
      messagesScanned: history.messages.length,
      reactionsRemoved,
      placeholdersPatched,
    });
  } catch (err) {
    // Preflight is best-effort — don't block startup
    log("warn", "slack_preflight_error", {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
