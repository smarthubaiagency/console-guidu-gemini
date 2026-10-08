import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Client } from "pg";

/**
 * Postgres for the end-to-end suite, served by PGlite over the wire protocol
 * so Prisma connects to it unchanged.
 *
 * It applies the identity migration **from the versioned file**, which is what
 * makes the suite fail if that DDL breaks. What it deliberately does not do is
 * prove RLS: PGlite only has a superuser, and a superuser bypasses row level
 * security. The isolation proof runs in the CI `db` job, on local Supabase,
 * connected as `app_runtime`.
 */

const AUTH_MIGRATION = "20261008120000_sma98_auth_identity_profiles.sql";

/** Roles that Supabase provides and the migration refers to by name. */
const BOOTSTRAP = `
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'app_migrations') then
      create role app_migrations nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
      create role app_runtime nologin noinherit;
    end if;
  end
  $$;

  grant app_migrations to postgres;
  grant app_runtime to postgres;
  grant usage, create on schema public to app_migrations;
  grant usage on schema public to app_runtime, anon, authenticated;

  -- Stand-in for the Supabase auth schema, which GoTrue owns in a real
  -- project. Only the column the profiles foreign key needs.
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key,
    email text not null
  );
`;

export type TestDatabase = Readonly<{
  url: string;
  insertAuthUser: (
    user: Readonly<{ id: string; email: string }>,
  ) => Promise<void>;
  blockIdentity: (email: string) => Promise<void>;
  countProfiles: (email: string) => Promise<number>;
  close: () => Promise<void>;
}>;

export async function startTestDatabase(
  port: number,
  repoRoot: string,
): Promise<TestDatabase> {
  const db = await PGlite.create();
  // The default is a single connection; Prisma's pool and this harness's own
  // client both need one.
  const server = new PGLiteSocketServer({
    db,
    port,
    host: "127.0.0.1",
    maxConnections: 10,
  });
  await server.start();

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  const client = new Client({ connectionString: url });
  await client.connect();

  await client.query(BOOTSTRAP);
  const migration = await readFile(
    path.join(repoRoot, "supabase", "migrations", AUTH_MIGRATION),
    "utf8",
  );
  await client.query(migration);

  return {
    url,
    insertAuthUser: async ({ id, email }) => {
      await client.query(
        "insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing",
        [id, email],
      );
    },
    blockIdentity: async (email) => {
      const result = await client.query(
        `update public.profiles
            set status = 'blocked',
                status_reason = 'e2e revocation',
                status_changed_at = now()
          where id = (select id from auth.users where lower(email) = lower($1))`,
        [email],
      );
      if (result.rowCount !== 1) {
        throw new Error(`no profile to block for ${email}`);
      }
    },
    countProfiles: async (email) => {
      const result = await client.query<{ count: string }>(
        `select count(*) as count
           from public.profiles
          where id = (select id from auth.users where lower(email) = lower($1))`,
        [email],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    close: async () => {
      await client.end();
      await server.stop();
      await db.close();
    },
  };
}
