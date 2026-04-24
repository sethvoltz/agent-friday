import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../log.js", () => ({
  log: vi.fn(),
}));

import { slackPreflight } from "./preflight.js";

function makeClient(messages: any[]) {
  return {
    conversations: {
      history: vi.fn().mockResolvedValue({ messages }),
    },
    reactions: {
      remove: vi.fn().mockResolvedValue({}),
    },
    chat: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

const emojis = {
  processing: "eyes",
  queued: "clock1",
  error: "x",
  complete: null,
};

const botUserId = "U_BOT";

describe("slackPreflight", () => {
  it("removes dangling processing reactions", async () => {
    const client = makeClient([
      {
        ts: "1234.5678",
        text: "do some work",
        user: "U_USER",
        reactions: [
          { name: "eyes", users: ["U_BOT"], count: 1 },
        ],
      },
    ]);

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });

    expect(client.reactions.remove).toHaveBeenCalledWith({
      channel: "C_TEST",
      timestamp: "1234.5678",
      name: "eyes",
    });
  });

  it("removes dangling queued reactions", async () => {
    const client = makeClient([
      {
        ts: "1234.5678",
        text: "queued message",
        user: "U_USER",
        reactions: [
          { name: "clock1", users: ["U_BOT"], count: 1 },
        ],
      },
    ]);

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });

    expect(client.reactions.remove).toHaveBeenCalledWith({
      channel: "C_TEST",
      timestamp: "1234.5678",
      name: "clock1",
    });
  });

  it("patches empty placeholders with restart notice", async () => {
    const client = makeClient([
      {
        ts: "1111.0000",
        text: "_..._",
        user: "U_BOT",
        bot_id: "B_BOT",
      },
      {
        ts: "2222.0000",
        text: "_Working..._",
        user: "U_BOT",
        bot_id: "B_BOT",
      },
    ]);

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });

    expect(client.chat.update).toHaveBeenCalledTimes(2);
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_TEST",
      ts: "1111.0000",
      text: "_Response interrupted — Friday restarted before replying._",
    });
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_TEST",
      ts: "2222.0000",
      text: "_Response interrupted — Friday restarted before replying._",
    });
  });

  it("patches partial streaming messages with connection-lost suffix", async () => {
    const client = makeClient([
      {
        ts: "1111.0000",
        text: "some response text\n\n_...streaming..._",
        user: "U_BOT",
        bot_id: "B_BOT",
      },
      {
        ts: "2222.0000",
        text: "partial reply\n\n_..._",
        user: "U_BOT",
        bot_id: "B_BOT",
      },
    ]);

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });

    expect(client.chat.update).toHaveBeenCalledTimes(2);
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_TEST",
      ts: "1111.0000",
      text: "some response text\n\n_... connection lost (Friday restarted)_",
    });
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: "C_TEST",
      ts: "2222.0000",
      text: "partial reply\n\n_... connection lost (Friday restarted)_",
    });
  });

  it("ignores non-bot messages that match placeholder text", async () => {
    const client = makeClient([
      {
        ts: "1234.5678",
        text: "_..._",
        user: "U_USER", // Not the bot
      },
    ]);

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });

    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it("ignores reactions from other users", async () => {
    const client = makeClient([
      {
        ts: "1234.5678",
        text: "a message",
        user: "U_USER",
        reactions: [
          { name: "eyes", users: ["U_OTHER"], count: 1 },
        ],
      },
    ]);

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });

    expect(client.reactions.remove).not.toHaveBeenCalled();
  });

  it("does not throw if history fails", async () => {
    const client = {
      conversations: {
        history: vi.fn().mockRejectedValue(new Error("channel_not_found")),
      },
      reactions: { remove: vi.fn() },
      chat: { update: vi.fn() },
    };

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });
  });

  it("handles empty channel gracefully", async () => {
    const client = makeClient([]);

    await slackPreflight({
      client: client as any,
      channelId: "C_TEST",
      emojis,
      botUserId,
    });

    expect(client.reactions.remove).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
  });
});
