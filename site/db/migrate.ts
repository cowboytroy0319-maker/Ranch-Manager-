/**
 * Migration runner — plain SQL files, no ORM, no codegen.
 *
 *   bun run db:migrate          # applies db/migrations/*.sql in filename order
 *
 * Applied filenames are tracked in a `schema_migrations` table, so re-running
 * is a no-op. Each migration runs inside a transaction: all of it applies or
 * none of it does.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, sql } from "../src/db";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** Split a .sql file into individual statements on semicolons (simple DDL —
 * no semicolons inside string literals in our migrations). `--` comment lines
 * are stripped first so semicolons inside comments can't break the split. */
function splitStatements(sqlText: string): string[] {
  const withoutComments = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runMigrations(): Promise<string[]> {
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = new Set<string>(
    (await db`SELECT name FROM schema_migrations`).map((r) => r.name as string)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    await db.begin(async (tx) => {
      for (const stmt of statements) await tx.unsafe(stmt);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    ran.push(file);
    console.log(`applied: ${file} (${statements.length} statements)`);
  }
  if (ran.length === 0) console.log("migrations: already up to date");
  return ran;
}

// Run directly: `bun db/migrate.ts`
if (import.meta.main) {
  runMigrations()
    .then((ran) => console.log(`done — ${ran.length} migration(s) applied`))
    .catch((err) => {
      console.error("migration failed:", err);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
