import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";

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
    if not exists (select 1 from pg_roles where rolname = 'app_rls_helper') then
      create role app_rls_helper nologin noinherit;
    end if;
  end
  $$;

  grant app_migrations to postgres;
  grant app_runtime to postgres;
  grant app_rls_helper to postgres;
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
  makePlatformAdmin: (email: string) => Promise<void>;
  seedWorkspace: (params: {
    email: string;
    orgName: string;
    orgSlug: string;
    wsName: string;
    wsSlug: string;
    role?: "owner" | "admin" | "member";
  }) => Promise<{ organizationId: string; workspaceId: string }>;
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
  const pool = new Pool({ connectionString: url, max: 10 });

  await pool.query(BOOTSTRAP);

  const { readdir } = await import("node:fs/promises");
  const migrationsDir = path.join(repoRoot, "supabase", "migrations");
  const allFiles = await readdir(migrationsDir);
  const migrationFiles = allFiles
    .filter((f) => f.startsWith("20261008") && f.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const migrationSql = await readFile(path.join(migrationsDir, file), "utf8");
    await pool.query(migrationSql);
  }

  return {
    url,
    insertAuthUser: async ({ id, email }) => {
      await pool.query(
        "insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing",
        [id, email],
      );
    },
    blockIdentity: async (email) => {
      const result = await pool.query(
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
      const result = await pool.query<{ count: string }>(
        `select count(*) as count
           from public.profiles
          where id = (select id from auth.users where lower(email) = lower($1))`,
        [email],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    makePlatformAdmin: async (email) => {
      await pool.query(
        `insert into public.platform_admin_members (user_id, role, status)
         select id, 'owner', 'active' from auth.users where lower(email) = lower($1)
         on conflict (user_id) do update set role = 'owner', status = 'active'`,
        [email],
      );
    },
    seedWorkspace: async (params) => {
      const userRes = await pool.query<{ id: string }>(
        `select id from auth.users where lower(email) = lower($1)`,
        [params.email],
      );
      const userId = userRes.rows[0]?.id;
      if (!userId) throw new Error(`User not found: ${params.email}`);

      await pool.query(
        `insert into public.profiles (id, full_name, status)
         values ($1, $2, 'active')
         on conflict (id) do nothing`,
        [userId, params.email.split("@")[0]],
      );

      const existingOrg = await pool.query<{ id: string }>(
        `select id from public.organizations where name = $1 limit 1`,
        [params.orgName],
      );
      let orgId = existingOrg.rows[0]?.id;
      if (!orgId) {
        const orgRes = await pool.query<{ id: string }>(
          `insert into public.organizations (id, name, max_seats, status)
           values (gen_random_uuid(), $1, 10, 'active')
           returning id`,
          [params.orgName],
        );
        orgId = orgRes.rows[0]!.id;
      }

      await pool.query(
        `insert into public.organization_members (organization_id, user_id, role, status)
         values ($1, $2, 'owner', 'active')
         on conflict (organization_id, user_id) do update set role = 'owner', status = 'active'`,
        [orgId, userId],
      );

      const existingWs = await pool.query<{ id: string }>(
        `select id from public.workspaces where slug = $1 limit 1`,
        [params.wsSlug],
      );
      let wsId = existingWs.rows[0]?.id;
      if (!wsId) {
        const wsRes = await pool.query<{ id: string }>(
          `insert into public.workspaces (id, organization_id, name, slug, status)
           values (gen_random_uuid(), $1, $2, $3, 'active')
           returning id`,
          [orgId, params.wsName, params.wsSlug],
        );
        wsId = wsRes.rows[0]!.id;
      } else {
        await pool.query(
          `update public.workspaces set organization_id = $1, name = $2 where id = $3`,
          [orgId, params.wsName, wsId],
        );
      }

      await pool.query(
        `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
         values ($1, $2, $3, $4, 'active')
         on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active'`,
        [wsId, orgId, userId, params.role || "owner"],
      );

      return { organizationId: orgId, workspaceId: wsId };
    },
    close: async () => {
      await pool.end();
      await server.stop();
      await db.close();
    },
  };
}
