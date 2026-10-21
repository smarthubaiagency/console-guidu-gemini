import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";

import { computeSeal } from "../../src/core/events/seal";
import { proposalHash } from "../../src/core/proposals/operation";
import { FAKE_RESEND_KEY } from "./fake-resend";
import { EXTERNAL_POSTGRES, RIG } from "./rig";

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
  makePlatformAdmin: (email: string, role?: string) => Promise<void>;
  seedWorkspace: (params: {
    email: string;
    orgName: string;
    orgSlug: string;
    wsName: string;
    wsSlug: string;
    role?: "owner" | "admin" | "member" | "viewer" | "attendant";
    /** Company role; owner unless given (the Attendant is a `member`). */
    orgRole?: "owner" | "admin" | "member";
  }) => Promise<{ organizationId: string; workspaceId: string }>;
  seedInvitation: (params: {
    organizationId: string;
    workspaceId?: string | undefined;
    email: string;
    role?: ("owner" | "admin" | "member" | "viewer" | "attendant") | undefined;
    expiresInHours?: number | undefined;
  }) => Promise<{ id: string; rawToken: string }>;
  seedPartner: (params: SeedPartnerParams) => Promise<{ partnerId: string }>;
  /** The AI module on in the workspace and maybe a draft GUIDS (A3c, A4a). */
  seedGuid: (params: SeedGuidParams) => Promise<{ agentId: string | null }>;
  /** Runs the real worker (`pnpm worker`) until no job is waiting. */
  runJobs: () => Promise<{ remaining: number }>;
  /** A notice in the bell of the user with that e-mail (CF3c). */
  seedNotification: (params: SeedNotificationParams) => Promise<{ id: string }>;
  /** Turns the maintenance window off (CF5c), keeping its fields. */
  maintenanceOff: () => Promise<void>;
  /** A sealed event of the Event Hub in a workspace, with one delivery (H1). */
  seedEvent: (params: SeedEventParams) => Promise<{ id: string }>;
  /** A CRM contact in a workspace, as its owner would add it (GB1c). */
  seedCrmContact: (params: {
    workspaceSlug: string;
    name: string;
  }) => Promise<{ id: string }>;
  /**
   * A managed company with a pending proposal to add a CRM contact (H4):
   * the workspace's company becomes managed by the partner, the CRM is on
   * and the proposal waits, with the hash of its content.
   */
  seedProposal: (params: {
    workspaceSlug: string;
    partnerId: string;
    name: string;
  }) => Promise<{ id: string }>;
  close: () => Promise<void>;
}>;

/** An event of the Event Hub, as `emitEvent` would write it (H1). */
export type SeedEventParams = {
  workspaceSlug: string;
  type: string;
  module: string;
  data: Record<string, unknown>;
};

/** A notice of the bell, as the worker would write it (CF3c). */
export type SeedNotificationParams = {
  email: string;
  eventType: string;
  data: Record<string, string>;
  linkUrl?: string | undefined;
};

/** A partner with an active domain, a member and, optionally, a customer. */
export type SeedPartnerParams = {
  slug: string;
  name: string;
  host: string;
  memberEmail: string;
  role:
    "partner_owner" | "partner_admin" | "partner_finance" | "partner_support";
  organizationId?: string | undefined;
};

/**
 * The AI module on in a workspace and, with a name, a draft GUIDS; with
 * `ready`, turned on with its configuration tested (A5b: takes an inbox).
 */
export type SeedGuidParams = {
  organizationId: string;
  workspaceId: string;
  agentName?: string | undefined;
  ready?: boolean | undefined;
};

/**
 * The socket server frees a connection slot only when the socket closes
 * cleanly: one that ends with an error (a worker killed or crashed mid-query
 * resets its sockets) keeps its slot forever, and once all of them are taken
 * every new connection is refused ("Can't reach database server"). Slots of
 * detached handlers are given back here.
 */
function releaseResetConnections(server: PGLiteSocketServer): void {
  const handlers = (
    server as unknown as { handlers: Set<{ isAttached: boolean }> }
  ).handlers;
  setInterval(() => {
    for (const handler of handlers) {
      if (!handler.isAttached) handlers.delete(handler);
    }
  }, 500).unref();
}

export async function startTestDatabase(
  port: number,
  repoRoot: string,
): Promise<TestDatabase> {
  let db: PGlite | null = null;
  let server: PGLiteSocketServer | null = null;
  if (EXTERNAL_POSTGRES) {
    // A fresh database on every run (the AI agents run reuses the service).
    const admin = new Pool({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
      max: 1,
    });
    await admin.query(
      `drop database if exists ${RIG.databaseName} with (force)`,
    );
    await admin.query(`create database ${RIG.databaseName}`);
    await admin.end();
  } else {
    db = await PGlite.create();
    // The default is a single connection. Every client needs its own: this
    // harness's pool, the web's Prisma (5), and while jobs run the worker's
    // Prisma (2) and pg-boss pool. Queries still run one at a time, so the
    // cap only has to stay above that sum; at 10 the worker's connections
    // were refused ("Can't reach database server", ECONNRESET) and its jobs
    // stayed queued.
    server = new PGLiteSocketServer({
      db,
      port,
      host: "127.0.0.1",
      maxConnections: 40,
    });
    await server.start();
    releaseResetConnections(server);
  }

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${RIG.databaseName}`;
  // Few connections of its own: its queries are short and mostly in turn.
  const pool = new Pool({ connectionString: url, max: 3 });
  await pool.query(BOOTSTRAP);

  const { readdir } = await import("node:fs/promises");
  const migrationsDir = path.join(repoRoot, "supabase", "migrations");
  const allFiles = await readdir(migrationsDir);
  const migrationFiles = allFiles
    .filter((f) => f >= "20261008" && f.endsWith(".sql"))
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
    makePlatformAdmin: async (email, role = "owner") => {
      await pool.query(
        `insert into public.platform_admin_members (user_id, role, status)
         select id, $2, 'active' from auth.users where lower(email) = lower($1)
         on conflict (user_id) do update set role = excluded.role, status = 'active'`,
        [email, role],
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
         values ($1, $2, $3, 'active')
         on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active'`,
        [orgId, userId, params.orgRole ?? "owner"],
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
    seedInvitation: async (params) => {
      const inviterRes = await pool.query<{ user_id: string }>(
        `select user_id from public.organization_members where organization_id = $1 limit 1`,
        [params.organizationId],
      );
      const inviterId = inviterRes.rows[0]?.user_id;
      if (!inviterId) {
        throw new Error(
          `No member found for organization ${params.organizationId}`,
        );
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
      const hours = params.expiresInHours ?? 168;

      const res = await pool.query<{ id: string }>(
        `insert into public.invitations (
           id, organization_id, workspace_id, email, role, token_hash,
           invited_by_user_id, status, expires_at, created_at, updated_at
         ) values (
           gen_random_uuid(), $1, $2, lower($3), $4, $5,
           $6, 'pending', now() + ($7 || ' hours')::interval, now(), now()
         ) returning id`,
        [
          params.organizationId,
          params.workspaceId ?? null,
          params.email,
          params.role ?? "member",
          tokenHash,
          inviterId,
          hours.toString(),
        ],
      );

      return { id: res.rows[0]!.id, rawToken };
    },
    seedPartner: async (params) => {
      const userRes = await pool.query<{ id: string }>(
        `select id from auth.users where lower(email) = lower($1)`,
        [params.memberEmail],
      );
      const userId = userRes.rows[0]?.id;
      if (!userId) throw new Error(`User not found: ${params.memberEmail}`);
      await pool.query(
        `insert into public.profiles (id, full_name, status)
         values ($1, $2, 'active')
         on conflict (id) do nothing`,
        [userId, params.memberEmail.split("@")[0]],
      );
      const partnerRes = await pool.query<{ id: string }>(
        `insert into public.partners (id, slug, name)
         values (gen_random_uuid(), $1, $2)
         returning id`,
        [params.slug, params.name],
      );
      const partnerId = partnerRes.rows[0]!.id;
      await pool.query(
        `insert into public.partner_domains (host, partner_id, kind, status)
         values (lower($1), $2, 'subdomain', 'active')`,
        [params.host, partnerId],
      );
      await pool.query(
        `insert into public.partner_members (partner_id, user_id, email, role)
         values ($1, $2, lower($3), $4)`,
        [partnerId, userId, params.memberEmail, params.role],
      );
      if (params.organizationId) {
        await pool.query(
          `update public.organizations set partner_id = $1 where id = $2`,
          [partnerId, params.organizationId],
        );
      }
      return { partnerId };
    },
    seedCrmContact: async (params) => {
      const result = await pool.query<{ id: string }>(
        `insert into public.crm_contacts (organization_id, workspace_id, name, created_by)
         select w.organization_id, w.id, $2,
                (select m.user_id from public.workspace_members m
                 where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1)
         from public.workspaces w where w.slug = $1
         returning id`,
        [params.workspaceSlug, params.name],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Workspace not found: ${params.workspaceSlug}`);
      return { id: row.id };
    },
    seedProposal: async (params) => {
      const ws = await pool.query<{
        id: string;
        organization_id: string;
        owner: string;
      }>(
        `select w.id, w.organization_id,
                (select m.user_id from public.workspace_members m
                 where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1) as owner
         from public.workspaces w where w.slug = $1`,
        [params.workspaceSlug],
      );
      const target = ws.rows[0];
      if (!target)
        throw new Error(`Workspace not found: ${params.workspaceSlug}`);
      await pool.query(
        `update public.organizations set partner_id = $1 where id = $2`,
        [params.partnerId, target.organization_id],
      );
      await pool.query(
        `insert into public.organization_service_modes (organization_id, partner_id, mode)
         values ($1, $2, 'gerenciado')
         on conflict (organization_id) do update
         set partner_id = excluded.partner_id, mode = 'gerenciado'`,
        [target.organization_id, params.partnerId],
      );
      await pool.query(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
         values ($1, $2, 'crm', 'enabled', $3)
         on conflict (workspace_id, module_key) do update set status = 'enabled'`,
        [target.organization_id, target.id, target.owner],
      );
      const payload = { name: params.name };
      const hash = proposalHash({
        workspaceId: target.id,
        operation: "crm.contacts.create",
        targetId: null,
        resourceVersion: null,
        payload,
      });
      const result = await pool.query<{ id: string }>(
        `insert into public.execution_proposals (organization_id, workspace_id, requested_by, origin,
           operation, payload, payload_hash, reason, idempotency_key, expires_at)
         values ($1, $2, $3, 'api_key', 'crm.contacts.create', $4::jsonb, $5, 'Lead da conversa',
           $6, now() + interval '24 hours')
         returning id`,
        [
          target.organization_id,
          target.id,
          target.owner,
          JSON.stringify(payload),
          hash,
          `e2e-${crypto.randomUUID()}`,
        ],
      );
      return { id: result.rows[0]!.id };
    },
    seedEvent: async (params) => {
      const ws = await pool.query<{
        id: string;
        organization_id: string;
        partner_id: string;
      }>(
        `select w.id, w.organization_id, o.partner_id from public.workspaces w
         join public.organizations o on o.id = w.organization_id where w.slug = $1`,
        [params.workspaceSlug],
      );
      const target = ws.rows[0];
      if (!target)
        throw new Error(`Workspace not found: ${params.workspaceSlug}`);
      const chainKey = `ws:${target.id}`;
      const head = await pool.query<{ content_hash: string; seq: string }>(
        `select content_hash, seq from public.events where chain_key = $1 order by seq desc limit 1`,
        [chainKey],
      );
      const id = crypto.randomUUID();
      const occurredAt = new Date();
      const prevHash = head.rows[0]?.content_hash ?? null;
      const contentHash = computeSeal(
        {
          id,
          type: params.type,
          partnerId: target.partner_id,
          organizationId: target.organization_id,
          workspaceId: target.id,
          subjectType: null,
          subjectId: null,
          createdBy: null,
          occurredAt,
          data: params.data,
          prevHash,
        },
        RIG.eventsHmacKey,
      );
      await pool.query(
        `insert into public.events (id, type, module, level, partner_id, organization_id, workspace_id,
           severity, audiences, route, data, idempotency_key, occurred_at, chain_key, seq,
           content_hash, prev_hash, key_version, dispatched_at)
         values ($1, $2, $3, 'workspace', $4, $5, $6, 'attention', array['customer'], 'service_mode',
           $7::jsonb, $8, $9, $10, $11, $12, $13, $14, now())`,
        [
          id,
          params.type,
          params.module,
          target.partner_id,
          target.organization_id,
          target.id,
          JSON.stringify(params.data),
          `e2e:${id}`,
          occurredAt,
          chainKey,
          Number(head.rows[0]?.seq ?? 0) + 1,
          contentHash,
          prevHash,
          RIG.eventsHmacKeyId,
        ],
      );
      await pool.query(
        `insert into public.notification_deliveries (partner_id, event_type, recipient_email, subject,
           idempotency_key, event_id, channel, status, reason)
         values ($1, $2, 'dono@e2e.test', 'Aviso', $3, $4, 'email', 'skipped', 'no_provider')`,
        [target.partner_id, params.type, `e2e:${id}:email`, id],
      );
      return { id };
    },
    maintenanceOff: async () => {
      await pool.query(
        `update public.platform_maintenance set enabled = false`,
      );
    },
    seedNotification: async (params) => {
      const userRes = await pool.query<{ id: string }>(
        `select id from auth.users where lower(email) = lower($1)`,
        [params.email],
      );
      const userId = userRes.rows[0]?.id;
      if (!userId) throw new Error(`User not found: ${params.email}`);
      const res = await pool.query<{ id: string }>(
        `insert into public.user_notifications (user_id, event_type, data, link_url, idempotency_key)
         values ($1, $2, $3::jsonb, $4, $5)
         returning id`,
        [
          userId,
          params.eventType,
          JSON.stringify(params.data),
          params.linkUrl ?? null,
          `e2e:${crypto.randomUUID()}`,
        ],
      );
      return { id: res.rows[0]!.id };
    },
    seedGuid: async (params) => {
      await pool.query(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status)
         values ($1, $2, 'ai-agents', 'enabled')
         on conflict (workspace_id, module_key) do update set status = 'enabled'`,
        [params.organizationId, params.workspaceId],
      );
      if (!params.agentName) return { agentId: null };
      const agentRes = await pool.query<{ id: string }>(
        `insert into public.ai_agents (kind, organization_id, workspace_id, config)
         values ('guid', $1, $2, jsonb_build_object('overview', jsonb_build_object('agent_name', $3::text)))
         returning id`,
        [params.organizationId, params.workspaceId, params.agentName],
      );
      const agentId = agentRes.rows[0]!.id;
      if (params.ready) {
        await pool.query(
          `update public.ai_agents
           set status = 'active', tested_config_hash = md5(config::text), tested_at = now()
           where id = $1`,
          [agentId],
        );
      }
      return { agentId };
    },
    runJobs: async () => {
      // A worker process only while jobs wait: constant polling would add
      // concurrent load to PGlite, which serves one session at a time.
      const { spawn } = await import("node:child_process");
      const child = spawn(
        path.join(repoRoot, "node_modules", ".bin", "tsx"),
        ["--conditions=react-server", "src/worker/index.ts"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            // PGlite serves one session: named prepared statements of two
            // Prisma clients (web and worker) would collide there.
            WORKER_DATABASE_URL: `${url}?pgbouncer=true&connection_limit=2`,
            WORKER_CONCURRENCY: "1",
            // pg-boss polls every queue (two dozen) through its own pool; a
            // small one keeps PGlite's single session from interleaving
            // statements and is plenty for a real Postgres too.
            // On PGlite a single one (H4): with two, an interleaved fetch of
            // a queue (one more since `events.subscriber`) lost its answer
            // ("unnamed prepared statement does not exist") and left the job
            // active in pg-boss, never run.
            WORKER_BOSS_MAX_CONNECTIONS: EXTERNAL_POSTGRES ? "2" : "1",
            GUIDU_MODULE_HELLO_WORLD_ENABLED: "true",
            // Seal of the Event Hub (H1), the same as the web's.
            EVENTS_HMAC_KEY: RIG.eventsHmacKey,
            EVENTS_HMAC_KEY_ID: RIG.eventsHmacKeyId,
            // Deterministic machine translation (I6); never the real provider.
            TRANSLATION_PROVIDER: "fake",
            TRANSLATION_ANTHROPIC_API_KEY: "",
            // Agent GMN (GB1b): never the real maps provider or AI.
            MAPS_INTELLIGENCE_PROVIDER: "fake",
            GB_SUGGESTIONS_PROVIDER: "fake",
            // E-mails of the dispatch (GB1c: the link of the service mode)
            // go to the Resend double, as the web's do.
            RESEND_API_KEY: FAKE_RESEND_KEY,
            RESEND_API_BASE: `http://127.0.0.1:${RIG.resendPort}`,
            EMAIL_FROM_ADDRESS: "avisos@guidu.test",
            // Translation of the chat (TR2): the key the web saved is read
            // with the web's cipher, and Google is the rig's double.
            ENCRYPTION_KEY:
              process.env.ENCRYPTION_KEY ||
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ENCRYPTION_KEY_ID: process.env.ENCRYPTION_KEY_ID || "k1",
            GUIDU_CHANNELS_ALLOW_PRIVATE: "true",
            GOOGLE_TRANSLATE_API_BASE: `http://127.0.0.1:${RIG.translatePort}`,
          },
          // Kept in memory and printed only when jobs stay stuck, so a CI
          // failure shows what the worker said.
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const output: string[] = [];
      const keep = (chunk: Buffer) => {
        output.push(...chunk.toString("utf8").split("\n").filter(Boolean));
        if (output.length > 80) output.splice(0, output.length - 80);
      };
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      const waiting = async () =>
        Number(
          (
            await pool.query<{ n: string }>(
              `select count(*) as n from public.job_runs
               where status in ('pending', 'queued', 'running')`,
            )
          ).rows[0]?.n ?? 0,
        );
      const deadline = Date.now() + 30_000;
      let remaining = await waiting();
      while (remaining > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        remaining = await waiting();
      }
      if (remaining > 0) {
        // Name what is stuck and what the worker said, so a CI failure says
        // which job kind to look at.
        const stuck = await pool.query(
          `select kind, status, attempts, run_after, last_error
             from public.job_runs
            where status in ('pending', 'queued', 'running')`,
        );
        console.error("run-jobs: still waiting", stuck.rows);
        console.error(`run-jobs: worker output\n${output.join("\n")}`);
      }
      // A worker stuck in a job never exits on SIGTERM and keeps PGlite's
      // single session: every request of the web then times out. After a
      // grace period it is killed, which closes its connection.
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const stopped = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 10_000),
        ),
      ]);
      if (!stopped) {
        console.error(
          `run-jobs: worker did not stop, killed\n${output.join("\n")}`,
        );
        child.kill("SIGKILL");
        await exited;
      }
      return { remaining };
    },
    close: async () => {
      await pool.end();
      await server?.stop();
      await db?.close();
    },
  };
}
