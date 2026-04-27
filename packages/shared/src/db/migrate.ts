import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Database as DatabaseType } from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { FridayDb } from "./client.js";

/**
 * Resolve the migrations folder relative to this file. Works from both:
 *   src/db/migrate.ts   (dev / tsx)        → ../../drizzle
 *   dist/db/migrate.js  (compiled output)  → ../../drizzle
 * Both resolve to packages/shared/drizzle.
 */
function resolveMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "drizzle");
}

/**
 * Apply pending migrations and ensure FTS5 tables/triggers exist.
 * Drizzle does not model FTS5 virtual tables, so they live in raw SQL
 * inside the migration file appended after the generated DDL.
 */
export function runMigrations(_db: FridayDb, raw: DatabaseType): void {
  const folder = resolveMigrationsFolder();
  migrate(_db, { migrationsFolder: folder });
  ensureFts5(raw);
}

/**
 * Idempotent FTS5 setup. The migration SQL also creates these, but we
 * re-assert them defensively so a corrupted FTS5 table can be recovered
 * by deleting it and reopening the DB.
 */
function ensureFts5(raw: DatabaseType): void {
  raw.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title, content, tags,
      content='memories',
      content_rowid='rowid'
    );
  `);
  raw.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, title, content, tags)
      VALUES (new.rowid, new.title, new.content, new.tags);
    END;
  `);
  raw.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
      VALUES ('delete', old.rowid, old.title, old.content, old.tags);
    END;
  `);
  raw.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
      VALUES ('delete', old.rowid, old.title, old.content, old.tags);
      INSERT INTO memories_fts(rowid, title, content, tags)
      VALUES (new.rowid, new.title, new.content, new.tags);
    END;
  `);
}
