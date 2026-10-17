import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Matrix setup for the Inbox core (IN3, ADR 0023). Runs on the operator's
 * machine, never in CI, and never prints a secret.
 *
 *   pnpm tsx scripts/matrix/setup.ts generate --server-name <name> \
 *     --homeserver-url https://dev.guidu.chat [--app-url https://console...] \
 *     [--out .matrix-setup] [--force]
 *       Writes, in --out (git-ignored):
 *       - guidu-as.yaml           Application Service registration (Synapse)
 *       - homeserver-snippet.yaml blocks to merge into homeserver.yaml
 *       - jwt-public.pem          public key of the attendant login (RS256)
 *       - console.env             MATRIX_* variables for the console (secret)
 *
 *   pnpm tsx scripts/matrix/setup.ts promote --env .matrix-setup/console.env
 *       Makes the Application Service sender a Synapse admin, once. Reads the
 *       bootstrap admin from MATRIX_BOOTSTRAP_USER / MATRIX_BOOTSTRAP_PASSWORD.
 *
 *   pnpm tsx scripts/matrix/setup.ts check --env .matrix-setup/console.env
 *       Checks the homeserver: versions, JWT login offered, AS token valid,
 *       AS sender is admin, and (when the registration has a URL) the AS ping.
 *
 * Without --app-url the registration has `url: null`: Synapse accepts it but
 * pushes no transactions until the console has a public address (or a
 * tunnel); the console still reaches Synapse.
 */

const AS_ID = "guidu-core";
const AS_SENDER = "_guidu_core";
const JWT_ISSUER = "guidu-console";
const JWT_AUDIENCE = "guidu-matrix";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command = "help", ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key?.startsWith("--")) fail(`Argumento inesperado: ${key}`);
    const name = key.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return { command, args };
}

function fail(message: string): never {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

function text(args: Args, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function token(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** YAML single-quoted scalar: only the quote itself needs doubling. */
function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function validUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} inválido: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail(`${label} precisa ser http ou https.`);
  }
  return url.toString().replace(/\/$/, "");
}

function generate(args: Args): void {
  const serverName = text(args, "server-name");
  if (!serverName || !/^[a-z0-9.-]+(:\d+)?$/i.test(serverName)) {
    fail(
      "informe --server-name (o server_name do Synapse, como está no homeserver.yaml).",
    );
  }
  const homeserverUrl = validUrl(
    text(args, "homeserver-url") ?? fail("informe --homeserver-url."),
    "--homeserver-url",
  );
  const appUrlArg = text(args, "app-url");
  const appUrl = appUrlArg ? validUrl(appUrlArg, "--app-url") : null;
  const out = path.resolve(text(args, "out") ?? ".matrix-setup");
  const files = [
    "guidu-as.yaml",
    "homeserver-snippet.yaml",
    "jwt-public.pem",
    "console.env",
  ];
  if (!args.force && files.some((f) => fs.existsSync(path.join(out, f)))) {
    fail(
      `${out} já tem arquivos de uma geração anterior. Use --force para gerar segredos novos (os antigos deixam de valer).`,
    );
  }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });

  const asToken = token();
  const hsToken = token();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const server = escapeRegex(serverName);

  const registration = [
    "# Application Service do núcleo do GUIDU (ADR 0023, regra 8).",
    "# Gerado por scripts/matrix/setup.ts. Contém segredos: não versionar.",
    `id: ${AS_ID}`,
    `url: ${appUrl ? yamlString(`${appUrl}/api/matrix/as`) : "null"}`,
    `as_token: ${yamlString(asToken)}`,
    `hs_token: ${yamlString(hsToken)}`,
    `sender_localpart: ${AS_SENDER}`,
    "rate_limited: false",
    "receive_ephemeral: false",
    "namespaces:",
    "  users:",
    "    - exclusive: true",
    `      regex: ${yamlString(`@_guidu_.*:${server}`)}`,
    "  aliases:",
    "    - exclusive: true",
    `      regex: ${yamlString(`#_guidu_.*:${server}`)}`,
    "  rooms: []",
    "",
  ].join("\n");

  const indentedKey = publicKey
    .trim()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  const snippet = [
    "# Blocos para o /data/homeserver.yaml (docs/operacao/synapse-easypanel.md).",
    "# Substitua os blocos de mesmo nome que já existirem.",
    "",
    "# Login dos atendentes pelo console: JWT RS256 curto, só a chave pública aqui.",
    "jwt_config:",
    "  enabled: true",
    '  algorithm: "RS256"',
    "  secret: |",
    indentedKey,
    '  subject_claim: "sub"',
    '  display_name_claim: "name"',
    `  issuer: "${JWT_ISSUER}"`,
    `  audiences: ["${JWT_AUDIENCE}"]`,
    "",
    "# Registro do Application Service (copie guidu-as.yaml para /data).",
    "app_service_config_files:",
    '  - "/data/guidu-as.yaml"',
    "",
    "# Sem criptografia de ponta a ponta nas salas novas (ADR 0023).",
    'encryption_enabled_by_default_for_room_type: "off"',
    "",
    "# Presença ligada (decisão de 17/10/2026).",
    "presence:",
    "  enabled: true",
    "",
    "# Logins por JWT em sequência quando vários atendentes entram juntos.",
    "rc_login:",
    "  address: { per_second: 1, burst_count: 20 }",
    "  account: { per_second: 1, burst_count: 20 }",
    "  failed_attempts: { per_second: 0.2, burst_count: 5 }",
    "",
  ].join("\n");

  const env = [
    "# Variáveis do console para o Matrix (IN3). Contém segredos: guarde no",
    "# cofre e nas variáveis do ambiente; nunca no chat nem no repositório.",
    `MATRIX_HOMESERVER_URL=${homeserverUrl}`,
    `MATRIX_SERVER_NAME=${serverName}`,
    `MATRIX_AS_ID=${AS_ID}`,
    `MATRIX_AS_SENDER=${AS_SENDER}`,
    `MATRIX_AS_TOKEN=${asToken}`,
    `MATRIX_HS_TOKEN=${hsToken}`,
    `MATRIX_JWT_ISSUER=${JWT_ISSUER}`,
    `MATRIX_JWT_AUDIENCE=${JWT_AUDIENCE}`,
    "# Chave privada PEM em base64, numa linha só.",
    `MATRIX_JWT_PRIVATE_KEY=${Buffer.from(privateKey).toString("base64")}`,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(out, "guidu-as.yaml"), registration, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(out, "homeserver-snippet.yaml"), snippet, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(out, "jwt-public.pem"), publicKey, {
    mode: 0o644,
  });
  fs.writeFileSync(path.join(out, "console.env"), env, { mode: 0o600 });

  console.log(`Arquivos gerados em ${out}:`);
  for (const file of files) console.log(`  - ${file}`);
  if (!appUrl) {
    console.log(
      "Sem --app-url: o Synapse não vai mandar eventos ao console até ele ter endereço público (ou um túnel). Gere de novo com --app-url quando tiver.",
    );
  }
  console.log("Próximos passos: docs/operacao/synapse-easypanel.md, seção 7.");
}

function readEnvFile(args: Args): Record<string, string> {
  const file = path.resolve(text(args, "env") ?? ".matrix-setup/console.env");
  if (!fs.existsSync(file)) fail(`arquivo não encontrado: ${file}`);
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2];
  }
  for (const key of [
    "MATRIX_HOMESERVER_URL",
    "MATRIX_SERVER_NAME",
    "MATRIX_AS_TOKEN",
    "MATRIX_AS_SENDER",
  ]) {
    if (!env[key]) fail(`${key} ausente em ${file}`);
  }
  return env;
}

async function call(
  base: string,
  method: string,
  route: string,
  accessToken?: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });
  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, json };
}

function senderId(env: Record<string, string>): string {
  return `@${env.MATRIX_AS_SENDER}:${env.MATRIX_SERVER_NAME}`;
}

async function promote(args: Args): Promise<void> {
  const env = readEnvFile(args);
  const base = env.MATRIX_HOMESERVER_URL as string;
  const user = process.env.MATRIX_BOOTSTRAP_USER;
  const password = process.env.MATRIX_BOOTSTRAP_PASSWORD;
  if (!user || !password) {
    fail(
      "defina MATRIX_BOOTSTRAP_USER e MATRIX_BOOTSTRAP_PASSWORD (o admin criado no guia, seção 4) só neste terminal.",
    );
  }
  const login = await call(
    base,
    "POST",
    "/_matrix/client/v3/login",
    undefined,
    {
      type: "m.login.password",
      identifier: { type: "m.id.user", user },
      password,
    },
  );
  const adminToken = login.json.access_token;
  if (login.status !== 200 || typeof adminToken !== "string") {
    fail(
      `login do admin recusado (HTTP ${login.status}, ${String(login.json.errcode ?? "")}).`,
    );
  }
  try {
    // The admin API only edits a user that exists in the users table, and
    // the AS sender gets there by registering through the AS itself.
    const register = await call(
      base,
      "POST",
      "/_matrix/client/v3/register",
      env.MATRIX_AS_TOKEN,
      {
        type: "m.login.application_service",
        username: env.MATRIX_AS_SENDER,
        inhibit_login: true,
      },
    );
    if (register.status !== 200 && register.json.errcode !== "M_USER_IN_USE") {
      fail(
        `o Synapse recusou o as_token (HTTP ${register.status}, ${String(register.json.errcode ?? "")}). O guidu-as.yaml está em app_service_config_files e o Synapse foi reiniciado?`,
      );
    }
    const target = encodeURIComponent(senderId(env));
    const result = await call(
      base,
      "PUT",
      `/_synapse/admin/v2/users/${target}`,
      adminToken,
      { admin: true },
    );
    if (result.status !== 200 && result.status !== 201) {
      fail(
        `não deu para promover ${senderId(env)} (HTTP ${result.status}, ${String(result.json.errcode ?? "")}). O Synapse já carregou o guidu-as.yaml?`,
      );
    }
    console.log(`${senderId(env)} agora é admin do Synapse.`);
  } finally {
    await call(base, "POST", "/_matrix/client/v3/logout", adminToken);
  }
}

async function check(args: Args): Promise<void> {
  const env = readEnvFile(args);
  const base = env.MATRIX_HOMESERVER_URL as string;
  const asToken = env.MATRIX_AS_TOKEN as string;
  let failures = 0;
  // A warning is expected during setup and does not fail the check.
  const report = (ok: boolean, label: string, detail = "", warn = false) => {
    if (!ok && !warn) failures += 1;
    const mark = ok ? "ok   " : warn ? "aviso" : "FALHA";
    console.log(`${mark} ${label}${detail ? ` (${detail})` : ""}`);
  };

  const versions = await call(base, "GET", "/_matrix/client/versions");
  report(versions.status === 200, "homeserver responde", base);

  const flows = await call(base, "GET", "/_matrix/client/v3/login");
  const types = Array.isArray(flows.json.flows)
    ? (flows.json.flows as { type?: string }[]).map((f) => f.type)
    : [];
  report(
    types.includes("org.matrix.login.jwt"),
    "login por JWT ligado",
    types.join(", "),
  );
  report(
    !types.includes("m.login.password"),
    "login por senha desligado",
    "pode ficar ligado até o fim do bootstrap",
    true,
  );

  const whoami = await call(
    base,
    "GET",
    "/_matrix/client/v3/account/whoami",
    asToken,
  );
  report(
    whoami.status === 200 && whoami.json.user_id === senderId(env),
    "as_token aceito pelo Synapse",
    String(whoami.json.user_id ?? whoami.json.errcode ?? whoami.status),
  );

  const admin = await call(
    base,
    "GET",
    `/_synapse/admin/v2/users/${encodeURIComponent(senderId(env))}`,
    asToken,
  );
  report(
    admin.status === 200 && admin.json.admin === true,
    "remetente do AS é admin",
    admin.status === 200 ? "" : `HTTP ${admin.status}`,
  );

  const ping = await call(
    base,
    "POST",
    `/_matrix/client/v1/appservice/${encodeURIComponent(env.MATRIX_AS_ID ?? AS_ID)}/ping`,
    asToken,
    {},
  );
  report(
    ping.status === 200,
    "Synapse alcança o console (ping do AS)",
    ping.status === 200
      ? `${String(ping.json.duration_ms)} ms`
      : `${String(ping.json.errcode ?? ping.status)}; esperado enquanto o console não tem endereço público`,
    true,
  );

  if (failures > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "generate") return generate(args);
  if (command === "promote") return promote(args);
  if (command === "check") return check(args);
  console.log(
    "Uso: pnpm tsx scripts/matrix/setup.ts generate|promote|check (ver o cabeçalho do arquivo).",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
