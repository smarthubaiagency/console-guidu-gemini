import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Migration runner for developer and CI environments.
 * Runs as `app_migrations` (migration administrator) to apply versioned migrations
 * from `supabase/migrations/` sequentially.
 */
async function main() {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files in ${migrationsDir}`);

  // Connect as app_migrations
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    `postgresql://app_migrations:ikkbI7I3t3Qw0fGbrda746XLkUF7VE9c@db.ssulunrysnvwyqjlkpry.supabase.co:5432/postgres`;

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
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
  console.error("Migration failed:", err);
  process.exit(1);
});
