# Drizzle migration rules

The DB layer (`~/.friday/friday.db`) is owned by `packages/shared/src/db/`.
Read this file before editing schema, writing migrations, or adding tables.

1. **Schema is in `packages/shared/src/db/schema.ts`.** Do not write raw
   `CREATE TABLE` SQL elsewhere — except FTS5 virtual tables and triggers,
   which Drizzle does not model and must live in `runMigrations()` (or in
   migration SQL) as idempotent statements.

2. **Never edit a migration that's already been applied.** Migrations are
   forward-only. To change a shipped column, generate a new migration that
   alters it.

3. **Generate, don't hand-write.** After editing `schema.ts`, run
   `pnpm --filter @friday/shared exec drizzle-kit generate`. Review the
   generated SQL in `packages/shared/drizzle/NNNN_*.sql` before committing
   — Drizzle sometimes regenerates harmless DDL that should be squashed.

4. **Commit the generated SQL and `meta/_journal.json`** alongside the
   schema change. They are the migration; the schema file is the source.

5. **Migrations apply on daemon boot** via `runMigrations()` in
   `packages/shared/src/db/migrate.ts`. There is no separate `pnpm migrate`
   step in production. Local dev: `pnpm --filter @friday/daemon dev`
   triggers it on startup.

6. **Destructive changes** (drop column, change type, narrow a constraint)
   require a manual review of the generated SQL — Drizzle may emit a column
   drop that loses data. If in doubt, write a multi-step migration: add new,
   backfill, switch reads, drop old.

7. **FTS5 and triggers are appended by hand** to `runMigrations()` (or an
   accompanying SQL block). Document them in a comment so the next reader
   knows which lines came from Drizzle and which were handwritten. They
   must use `IF NOT EXISTS` so they're safe to re-run on every boot.

8. **Test against a backup of `~/.friday/friday.db`** before merging
   anything that touches schema. Copy the file, run the daemon against the
   copy, confirm migration succeeds and existing rows survive. Do **not**
   experiment against the live DB.
