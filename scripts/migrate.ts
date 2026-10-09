import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { assertDevDatabase } from "./lib/dev-database.js";

/**
 * Migration runner for developer and CI environments.
 * Runs as `app_migrations` (migration administrator) to apply versioned migrations
 * from `supabase/migrations/` sequentially.
 *
 * Enforces ADR 0008 and ADR 0010:
 * - Requires MIGRATION_DATABASE_URL environment variable (no fallback).
 * - Restricts execution to console-guidu (ssulunrysnvwyqjlkpry) or local test host.
 * - Never prints raw database credentials.
 */
async function main() {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files in ${migrationsDir}`);

  // Validate database URL against ADR 0010 governance rules
  const db = assertDevDatabase(process.env.MIGRATION_DATABASE_URL);
  console.log(
    `Target database: ${db.host} (role: ${db.user || "app_migrations"})`,
  );

  const client = new pg.Client({
    connectionString: db.url,
    ssl:
      db.host === "localhost" || db.host === "127.0.0.1"
        ? false
        : { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Ensure schema_migrations table is accessible
    const { rows: appliedRows } = await client.query<{ version: string }>(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match || !match[1] || !match[2]) {
        console.warn(`Skipping invalid migration filename format: ${file}`);
        continue;
      }

      const version = match[1];
      const name = match[2];
      if (appliedVersions.has(version)) {
        console.log(`- Migration ${version} (${name}) already applied`);
        continue;
      }

      console.log(`Applying migration ${version} (${name})...`);
      const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sqlContent);
        await client.query(
          "insert into supabase_migrations.schema_migrations(version, name, statements) values ($1, $2, $3)",
          [version, name, []],
        );
        await client.query("COMMIT");
        console.log(`✓ Migration ${version} (${name}) applied successfully`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`✗ Error applying migration ${version} (${name}):`, error);
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
