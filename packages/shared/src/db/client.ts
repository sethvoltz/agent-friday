import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import * as schema from "./schema.js";
import { runMigrations } from "./migrate.js";

export const FRIDAY_DB_PATH = join(homedir(), ".friday", "friday.db");

export type FridayDb = BetterSQLite3Database<typeof schema>;

let cachedDb: FridayDb | null = null;
let cachedRaw: DatabaseType | null = null;

/**
 * Open (or return the cached handle for) ~/.friday/friday.db.
 * Sets WAL mode so the daemon and the dashboard can hold concurrent
 * connections to the same file. Migrations run on first open per process.
 */
export function getDb(): FridayDb {
  if (cachedDb) return cachedDb;

  mkdirSync(dirname(FRIDAY_DB_PATH), { recursive: true });
  const sqlite = new Database(FRIDAY_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });
  runMigrations(db, sqlite);

  cachedRaw = sqlite;
  cachedDb = db;
  return db;
}

/** Underlying better-sqlite3 handle. Use for raw SQL (FTS5 queries, PRAGMAs). */
export function getRawDb(): DatabaseType {
  if (!cachedRaw) getDb();
  return cachedRaw!;
}

/** For tests + clean shutdown. */
export function closeDb(): void {
  if (cachedRaw) {
    cachedRaw.close();
    cachedRaw = null;
    cachedDb = null;
  }
}
