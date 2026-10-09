import fs from "node:fs";
import pg from "pg";
import { assertDevDatabase } from "./lib/dev-database.js";

/**
 * Seeds administrative test fixtures from `tests/core/admin-seed.sql`.
 *
 * Enforces ADR 0008 and ADR 0010:
 * - Requires MIGRATION_DATABASE_URL environment variable (no fallback).
 * - Restricts execution to console-guidu (ssulunrysnvwyqjlkpry) or local test host.
 * - Never prints raw database credentials.
 */
async function seed() {
  const db = assertDevDatabase(process.env.MIGRATION_DATABASE_URL);
  console.log(
    `Seeding admin fixtures into: ${db.host} (role: ${db.user || "app_migrations"})`,
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
    const sql = fs.readFileSync("tests/core/admin-seed.sql", "utf8");
    await client.query(sql);
    console.log("Admin test fixtures seeded successfully");
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error(
    "Failed to seed admin fixtures:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
