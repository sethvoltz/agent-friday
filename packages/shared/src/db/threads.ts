import { eq } from "drizzle-orm";
import { getDb } from "./client.js";
import { threadConnections } from "./schema.js";
import type { ThreadConnectionInsert, ThreadConnectionRow } from "./schema.js";

export function insertThreadConnection(row: ThreadConnectionInsert): void {
  getDb().insert(threadConnections).values(row).run();
}

export function deleteThreadConnection(agentName: string): void {
  getDb().delete(threadConnections).where(eq(threadConnections.agentName, agentName)).run();
}

export function getThreadConnectionByAgent(agentName: string): ThreadConnectionRow | undefined {
  return getDb()
    .select()
    .from(threadConnections)
    .where(eq(threadConnections.agentName, agentName))
    .get();
}

export function getThreadConnectionByThread(threadTs: string): ThreadConnectionRow | undefined {
  return getDb()
    .select()
    .from(threadConnections)
    .where(eq(threadConnections.threadTs, threadTs))
    .get();
}

export function updateThreadActivity(agentName: string, lastActivityAt: number): void {
  getDb()
    .update(threadConnections)
    .set({ lastActivityAt })
    .where(eq(threadConnections.agentName, agentName))
    .run();
}

export function getAllThreadConnections(): ThreadConnectionRow[] {
  return getDb().select().from(threadConnections).all();
}
