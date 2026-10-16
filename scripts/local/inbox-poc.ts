/**
 * PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md).
 * Roteiro da prova, em subcomandos. Lê os segredos de
 * $SYNAPSE_POC_DIR/poc.env (scripts/local/synapse-poc.sh setup).
 *
 *   pnpm tsx scripts/local/inbox-poc.ts auth        # GoTrue falso sobre o Postgres local (fica no ar)
 *   pnpm tsx scripts/local/inbox-poc.ts seed        # usuário e workspace do console
 *   pnpm tsx scripts/local/inbox-poc.ts bootstrap   # usuário do núcleo vira admin do Synapse
 *   pnpm tsx scripts/local/inbox-poc.ts consumer    # faz o papel do guidu.chat (itens 4 a 6, 8 e 9)
 *   pnpm tsx scripts/local/inbox-poc.ts rooms300 <mxid>   # 300 salas para um atendente (item 7)
 *   pnpm tsx scripts/local/inbox-poc.ts measure <userId>  # sync clássico x Sliding Sync (item 7)
 *
 * Nada aqui é código de produto. A IN3 troca tudo por adaptador, tabelas,
 * cofre, fila e testes.
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";

const DIR = process.env.SYNAPSE_POC_DIR ?? "/tmp/guidu-synapse-poc";
const ENV = Object.fromEntries(
  readFileSync(join(DIR, "poc.env"), "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
) as Record<string, string>;
const HS = ENV.MATRIX_HOMESERVER_URL!;
const SERVER = ENV.MATRIX_SERVER_NAME!;
const AS_TOKEN = ENV.MATRIX_AS_TOKEN!;
const CORE = `@${ENV.MATRIX_AS_SENDER}:${SERVER}`;
const WS = process.env.POC_WORKSPACE ?? "loja-poc";
const AGENT = `@_guidu_agent_${WS}:${SERVER}`;
const DB_URL = process.env.POC_ADMIN_DB_URL ?? "postgresql://postgres@127.0.0.1:54333/guidu_in1";
const AUTH_PORT = Number(process.env.POC_AUTH_PORT ?? 54420);
const EMAIL = process.env.POC_EMAIL ?? "ana@loja-poc.test";
const PASSWORD = "senha-de-teste-12345";

const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Json = Record<string, unknown>;

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  asUser?: string,
): Promise<{ status: number; json: Json; bytes: number; ms: number }> {
  const url = new URL(HS + path);
  if (asUser) url.searchParams.set("user_id", asUser);
  const started = performance.now();
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
    bytes: Buffer.byteLength(text),
    ms: Math.round(performance.now() - started),
  };
}

function show(label: string, result: { status: number; json: unknown }): void {
  console.log(`${label}: HTTP ${result.status} ${JSON.stringify(result.json).slice(0, 400)}`);
}

/** Cadastro por segredo compartilhado (só scripts; o cadastro aberto está desligado). */
async function sharedSecretRegister(
  username: string,
  admin: boolean,
): Promise<{ access_token: string; user_id: string }> {
  const nonceResponse = await fetch(`${HS}/_synapse/admin/v1/register`);
  const { nonce } = (await nonceResponse.json()) as { nonce: string };
  const password = randomUUID();
  const mac = createHmac("sha1", ENV.MATRIX_REGISTRATION_SHARED_SECRET!)
    .update(`${nonce}\0${username}\0${password}\0${admin ? "admin" : "notadmin"}`)
    .digest("hex");
  const response = await fetch(`${HS}/_synapse/admin/v1/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, username, password, admin, mac }),
  });
  const json = (await response.json()) as Json;
  if (!response.ok) throw new Error(`register ${username}: ${JSON.stringify(json)}`);
  return json as { access_token: string; user_id: string };
}

function signJwt(localpart: string, ttl = 60): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: localpart,
    iss: ENV.MATRIX_JWT_ISSUER,
    aud: ENV.MATRIX_JWT_AUDIENCE,
    iat: now,
    exp: now + ttl,
  });
  const sig = createHmac("sha256", ENV.MATRIX_JWT_SECRET!).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

// ---------------------------------------------------------------------------

async function auth(): Promise<void> {
  const { startFakeGoTrue } = await import("../../e2e/support/fake-gotrue");
  const pool = new Pool({ connectionString: DB_URL, max: 4 });
  const notUsed = async () => {
    throw new Error("fora da prova");
  };
  await startFakeGoTrue({
    port: AUTH_PORT,
    onUserCreated: async ({ id, email }) => {
      await pool.query(
        "insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing",
        [id, email],
      );
    },
    onBlockIdentity: notUsed,
    onCountProfiles: async () => 0,
    onMakePlatformAdmin: notUsed,
    onSeedWorkspace: async (params) => {
      const user = await pool.query<{ id: string }>(
        "select id from auth.users where lower(email) = lower($1)",
        [params.email],
      );
      const userId = user.rows[0]!.id;
      await pool.query(
        "insert into public.profiles (id, full_name, status) values ($1, $2, 'active') on conflict (id) do nothing",
        [userId, "Ana Atendente"],
      );
      const org = await pool.query<{ id: string }>(
        "insert into public.organizations (id, name, max_seats, status) values (gen_random_uuid(), $1, 10, 'active') returning id",
        [params.orgName],
      );
      const orgId = org.rows[0]!.id;
      await pool.query(
        "insert into public.organization_members (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')",
        [orgId, userId],
      );
      const ws = await pool.query<{ id: string }>(
        "insert into public.workspaces (id, organization_id, name, slug, status) values (gen_random_uuid(), $1, $2, $3, 'active') returning id",
        [orgId, params.wsName, params.wsSlug],
      );
      const wsId = ws.rows[0]!.id;
      await pool.query(
        "insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values ($1, $2, $3, 'owner', 'active')",
        [wsId, orgId, userId],
      );
      return { organizationId: orgId, workspaceId: wsId };
    },
  });
  await pool.query("update public.platform_maintenance set enabled = false").catch(() => undefined);
  console.log(`GoTrue falso em http://127.0.0.1:${AUTH_PORT} (banco ${DB_URL})`);
  await new Promise(() => undefined);
}

async function seed(): Promise<void> {
  const base = `http://127.0.0.1:${AUTH_PORT}/auth/v1/__control`;
  const user = await fetch(`${base}/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const { id } = (await user.json()) as { id: string };
  const ws = await fetch(`${base}/seed-workspace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: EMAIL,
      orgName: "Loja POC",
      orgSlug: "loja-poc",
      wsName: "Loja POC",
      wsSlug: WS,
    }),
  });
  console.log("usuário", id, EMAIL, PASSWORD, "workspace", await ws.json());
}

async function bootstrap(): Promise<void> {
  // Um admin descartável só para promover o usuário do núcleo; depois disso
  // o núcleo usa apenas o as_token, inclusive na API admin.
  const admin = await sharedSecretRegister(`poc_admin_${Date.now()}`, true);
  show(
    "registro do usuário do núcleo pelo AS",
    await call(AS_TOKEN, "POST", "/_matrix/client/v3/register", {
      type: "m.login.application_service",
      username: ENV.MATRIX_AS_SENDER,
      inhibit_login: true,
    }),
  );
  show(
    "promove o núcleo a admin",
    await call(admin.access_token, "PUT", `/_synapse/admin/v2/users/${enc(CORE)}`, { admin: true }),
  );
  show("whoami com as_token", await call(AS_TOKEN, "GET", "/_matrix/client/v3/account/whoami"));
  show(
    "API admin com as_token (lista de usuários)",
    await call(AS_TOKEN, "GET", "/_synapse/admin/v2/users?limit=3"),
  );
  // Desativa o admin descartável (sem apagar dados).
  show(
    "desativa o admin descartável",
    await call(AS_TOKEN, "POST", `/_synapse/admin/v1/deactivate/${enc(admin.user_id)}`, { erase: false }),
  );
}

/** Espera um evento que satisfaça `match` no /sync do consumidor. */
async function waitFor(
  token: string,
  since: { value: string | undefined },
  match: (event: Json, roomId: string, section: string) => boolean,
  timeoutMs = 20000,
): Promise<{ event: Json; roomId: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const qs = new URLSearchParams({ timeout: "5000", ...(since.value ? { since: since.value } : {}) });
    const sync = await call(token, "GET", `/_matrix/client/v3/sync?${qs}`);
    since.value = String(sync.json.next_batch);
    const rooms = (sync.json.rooms ?? {}) as Record<string, Record<string, Json>>;
    for (const [section, entries] of Object.entries(rooms)) {
      for (const [roomId, room] of Object.entries(entries ?? {})) {
        const lists = [
          ...(((room.timeline as Json)?.events as Json[]) ?? []),
          ...(((room.state as Json)?.events as Json[]) ?? []),
          ...(((room.invite_state as Json)?.events as Json[]) ?? []),
        ];
        for (const event of lists) if (match(event, roomId, section)) return { event, roomId };
      }
    }
  }
  return null;
}

async function consumer(): Promise<void> {
  const name = `cliente_${Date.now().toString(36)}`;
  const me = await sharedSecretRegister(name, false);
  const token = me.access_token;
  console.log(`consumidor (papel do guidu.chat): ${me.user_id}`);
  const since = { value: undefined as string | undefined };
  since.value = String((await call(token, "GET", "/_matrix/client/v3/sync?timeout=0")).json.next_batch);

  // 1. Pede conversa: cria uma sala e convida o agente do workspace.
  const own = await call(token, "POST", "/_matrix/client/v3/createRoom", {
    preset: "private_chat",
    invite: [AGENT],
    name: "pedido de conversa",
  });
  show("consumidor cria sala e convida o agente", own);

  // 2. O núcleo recusa essa sala e abre a dele; o consumidor recebe o convite.
  const invite = await waitFor(token, since, (event, _roomId, section) =>
    section === "invite" && event.type === "m.room.member" && event.state_key === me.user_id,
  );
  if (!invite) throw new Error("sem convite do núcleo");
  const roomId = invite.roomId;
  console.log(`convite do núcleo para a sala ${roomId}`);
  show("consumidor entra", await call(token, "POST", `/_matrix/client/v3/rooms/${enc(roomId)}/join`, {}));
  const ownMembers = await call(token, "GET", `/_matrix/client/v3/rooms/${enc(String(own.json.room_id))}/joined_members`);
  console.log(`membros da sala do consumidor depois da recusa: ${Object.keys((ownMembers.json.joined as Json) ?? {}).join(", ")}`);

  // 3. Manda mensagem e espera a resposta do agente.
  const sent = await call(token, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${randomUUID()}`, {
    msgtype: "m.text",
    body: "Oi, vocês abrem no sábado?",
  });
  show("consumidor envia", sent);
  const t0 = Date.now();
  const reply = await waitFor(token, since, (event, room) =>
    room === roomId && event.type === "m.room.message" && event.sender === AGENT &&
    String((event.content as Json).body).includes("sábado"),
  );
  console.log(`resposta do agente em ${Date.now() - t0} ms: ${JSON.stringify(reply?.event.content)}`);

  // 4. Estado da conversa (item 6) e o que o consumidor enxerga (item 9).
  show("consumidor lê chat.guidu.conversation", await call(token, "GET", `/_matrix/client/v3/rooms/${enc(roomId)}/state/chat.guidu.conversation/`));
  const state = await call(token, "GET", `/_matrix/client/v3/rooms/${enc(roomId)}/state`);
  console.log("state events visíveis ao consumidor:");
  for (const event of state.json as unknown as Json[]) {
    console.log(`  ${event.type} [${event.state_key}] ${JSON.stringify(event.content).slice(0, 160)}`);
  }

  // 5. Tentativas que precisam falhar (item 8 e 6).
  show("consumidor tenta ligar E2EE", await call(token, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.encryption/`, { algorithm: "m.megolm.v1.aes-sha2" }));
  show("consumidor tenta mudar o status", await call(token, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/state/chat.guidu.conversation/`, { version: 1, status: "resolved", assignee: null }));
  show("consumidor tenta mudar power levels", await call(token, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.power_levels/`, { users: { [me.user_id]: 100 } }));
  show("consumidor tenta convidar outra pessoa", await call(token, "POST", `/_matrix/client/v3/rooms/${enc(roomId)}/invite`, { user_id: `@intruso:${SERVER}` }));
  show("consumidor tenta mensagem com tipo customizado (vira visível a todos)", await call(token, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/send/chat.guidu.note/${randomUUID()}`, { body: "teste" }));

  // 6. Pede atendente: o agente transfere e o status vira "open".
  await call(token, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${randomUUID()}`, {
    msgtype: "m.text",
    body: "Quero falar com um atendente",
  });
  const handoff = await waitFor(token, since, (event, room) =>
    room === roomId && event.type === "chat.guidu.conversation",
  );
  console.log(`estado depois da transferência (escrito pelo núcleo): ${JSON.stringify(handoff?.event.content)} por ${handoff?.event.sender}`);

  // 7. Espera o console: mensagem do atendente e mudança de status.
  console.log("aguardando o atendente no console (até 180 s)…");
  const deadline = Date.now() + 180000;
  let gotMessage = false;
  let gotState = false;
  while (Date.now() < deadline && !(gotMessage && gotState)) {
    const seen = await waitFor(token, since, (event, room) =>
      room === roomId &&
      String(event.sender).startsWith("@u_") &&
      (event.type === "m.room.message" || event.type === "chat.guidu.conversation"),
      10000,
    );
    if (!seen) continue;
    if (seen.event.type === "m.room.message") {
      gotMessage = true;
      console.log(`mensagem do atendente vista pelo consumidor: ${seen.event.sender}: ${JSON.stringify(seen.event.content)}`);
      {
        await call(token, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${randomUUID()}`, {
          msgtype: "m.text",
          body: "Obrigado, Ana!",
        });
      }
    } else {
      gotState = true;
      console.log(`estado escrito pelo console, lido pelo consumidor: ${JSON.stringify(seen.event.content)} por ${seen.event.sender}`);
    }
  }
  console.log(`sala: ${roomId}`);
}

async function rooms300(attendant: string): Promise<void> {
  const total = Number(process.env.POC_ROOMS ?? 300);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const created = await call(AS_TOKEN, "POST", "/_matrix/client/v3/createRoom", {
      preset: "private_chat",
      name: `Carga ${String(i + 1).padStart(3, "0")}`,
      initial_state: [
        { type: "chat.guidu.conversation", state_key: "", content: { version: 1, status: "pending", assignee: null } },
      ],
      power_level_content_override: {
        users: { [attendant]: 50 },
        events: { "m.room.encryption": 100, "chat.guidu.conversation": 50 },
        state_default: 100,
      },
    });
    const roomId = String(created.json.room_id);
    await call(AS_TOKEN, "POST", `/_synapse/admin/v1/join/${enc(roomId)}`, { user_id: attendant });
    for (let m = 0; m < 3; m++) {
      await call(AS_TOKEN, "PUT", `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${randomUUID()}`, {
        msgtype: "m.text",
        body: `Mensagem ${m + 1} da sala ${i + 1}: ${"texto de exemplo ".repeat(4)}`,
      });
    }
    if ((i + 1) % 50 === 0) console.log(`${i + 1} salas (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  const joined = await call(AS_TOKEN, "GET", `/_synapse/admin/v1/users/${enc(attendant)}/joined_rooms`);
  console.log(`salas do atendente: ${(joined.json.joined_rooms as unknown[]).length}`);
}

async function measure(userId: string): Promise<void> {
  const localpart = `u_${userId.replace(/-/g, "")}`;
  const login = async () => {
    const response = await fetch(`${HS}/_matrix/client/v3/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "org.matrix.login.jwt", token: signJwt(localpart) }),
    });
    return (await response.json()) as { access_token: string; user_id: string; device_id: string };
  };
  const runs = Number(process.env.POC_RUNS ?? 3);
  const row = (label: string, values: { ms: number; bytes: number; rooms: number }[]) => {
    const ms = values.map((v) => v.ms).sort((a, b) => a - b);
    console.log(
      `${label}: mediana ${ms[Math.floor(ms.length / 2)]} ms (${ms.join(", ")}), ${Math.round(values[0]!.bytes / 1024)} KiB, ${values[0]!.rooms} salas na resposta`,
    );
  };

  // HTTP cru: /sync inicial completo, o mesmo com filtro enxuto, e Sliding Sync.
  const classic = [];
  const filtered = [];
  const sliding = [];
  for (let i = 0; i < runs; i++) {
    const { access_token } = await login();
    const full = await call(access_token, "GET", "/_matrix/client/v3/sync?timeout=0");
    classic.push({ ...full, rooms: Object.keys(((full.json.rooms as Json)?.join as Json) ?? {}).length });
    const filter = JSON.stringify({
      room: { timeline: { limit: 1 }, state: { lazy_load_members: true }, ephemeral: { types: [] }, account_data: { types: [] } },
      presence: { types: [] },
      account_data: { types: [] },
    });
    const lean = await call(access_token, "GET", `/_matrix/client/v3/sync?timeout=0&filter=${enc(filter)}`);
    filtered.push({ ...lean, rooms: Object.keys(((lean.json.rooms as Json)?.join as Json) ?? {}).length });
    const ss = await call(access_token, "POST", "/_matrix/client/unstable/org.matrix.simplified_msc3575/sync?timeout=0", {
      lists: {
        conversas: {
          ranges: [[0, 19]],
          timeline_limit: 1,
          required_state: [["m.room.name", ""], ["chat.guidu.conversation", ""]],
        },
      },
    });
    if (ss.status !== 200) show("sliding sync", ss);
    const lists = (ss.json.lists as Record<string, Json>) ?? {};
    console.log(`  sliding: count da lista = ${lists.conversas?.count}`);
    sliding.push({ ...ss, rooms: Object.keys((ss.json.rooms as Json) ?? {}).length });
  }
  row("HTTP /sync inicial (sem filtro)", classic);
  row("HTTP /sync inicial (timeline 1, lazy members)", filtered);
  row("HTTP Sliding Sync (MSC4186, 20 primeiras)", sliding);

  // matrix-js-sdk no Node: tempo até a primeira lista.
  const sdk = await import("matrix-js-sdk");
  const { SlidingSync, SlidingSyncEvent } = await import("matrix-js-sdk/lib/sliding-sync.js");
  const sdkClassic = [];
  const sdkSliding = [];
  for (let i = 0; i < runs; i++) {
    {
      const creds = await login();
      const client = sdk.createClient({ baseUrl: HS, accessToken: creds.access_token, userId: creds.user_id, deviceId: creds.device_id });
      const started = performance.now();
      await new Promise<void>((resolve) => {
        client.once(sdk.ClientEvent.Sync, () => resolve());
        void client.startClient({ initialSyncLimit: 20 });
      });
      sdkClassic.push({ ms: Math.round(performance.now() - started), bytes: 0, rooms: client.getRooms().length });
      client.stopClient();
    }
    {
      const creds = await login();
      const client = sdk.createClient({ baseUrl: HS, accessToken: creds.access_token, userId: creds.user_id, deviceId: creds.device_id });
      const sliding = new SlidingSync(
        HS,
        new Map([["conversas", { ranges: [[0, 19]], timeline_limit: 1, required_state: [["m.room.name", ""], ["chat.guidu.conversation", ""]] }]]),
        { timeline_limit: 30, required_state: [["*", "*"]] },
        client,
        30000,
      );
      const started = performance.now();
      let error: unknown = null;
      await new Promise<void>((resolve) => {
        sliding.once(SlidingSyncEvent.Lifecycle, (_state: unknown, _resp: unknown, err?: unknown) => {
          error = err ?? null;
          resolve();
        });
        void client.startClient({ slidingSync: sliding });
      });
      const ms = Math.round(performance.now() - started);
      await sleep(300);
      sdkSliding.push({ ms, bytes: 0, rooms: client.getRooms().length });
      if (error) console.log("  erro do sliding sync no SDK:", error);
      console.log(`  sdk sliding: listData count = ${sliding.getListData("conversas")?.joinedCount}, salas no cliente = ${client.getRooms().length}`);
      client.stopClient();
    }
  }
  row("matrix-js-sdk sync clássico (até o primeiro Sync)", sdkClassic);
  row("matrix-js-sdk Sliding Sync (até a primeira resposta)", sdkSliding);
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  auth,
  seed,
  bootstrap,
  consumer,
  rooms300: () => rooms300(arg ?? ""),
  measure: () => measure(arg ?? ""),
};
const run = commands[command ?? ""];
if (!run) {
  console.log("subcomandos: auth, seed, bootstrap, consumer, rooms300 <mxid>, measure <userId>");
  process.exit(1);
}
run().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
