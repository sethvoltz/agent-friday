import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { SESSIONS_DIR } from "@friday/shared";
import { join } from "node:path";
import { log } from "../log.js";

const CHANNELS_FILE = join(SESSIONS_DIR, "channels.json");

interface ChannelSessions {
  [channelId: string]: string; // channelId → sessionId
}

let sessions: ChannelSessions = {};

export function loadSessions(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  if (existsSync(CHANNELS_FILE)) {
    sessions = JSON.parse(readFileSync(CHANNELS_FILE, "utf-8"));
    log("info", "sessions_loaded", {
      count: Object.keys(sessions).length,
    });
  }
}

function saveSessions(): void {
  writeFileSync(CHANNELS_FILE, JSON.stringify(sessions, null, 2));
}

export function getSessionId(channelId: string): string | undefined {
  return sessions[channelId];
}

export function setSessionId(channelId: string, sessionId: string): void {
  sessions[channelId] = sessionId;
  saveSessions();
}

export function resetSession(channelId: string): void {
  delete sessions[channelId];
  saveSessions();
}
