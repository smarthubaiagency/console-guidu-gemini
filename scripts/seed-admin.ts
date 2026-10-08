import fs from "node:fs";
import pg from "pg";

async function seed() {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    "postgresql://app_migrations:ikkbI7I3t3Qw0fGbrda746XLkUF7VE9c@db.ssulunrysnvwyqjlkpry.supabase.co:5432/postgres";

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const sql = fs.readFileSync("tests/core/admin-seed.sql", "utf8");
  await client.query(sql);
  console.log("Admin test fixtures seeded successfully");
  await client.end();
}

seed().catch((err) => {
  console.error("Failed to seed admin fixtures:", err);
  process.exit(1);
});
