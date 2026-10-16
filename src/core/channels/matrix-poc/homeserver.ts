import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import type { MatrixPocConfig } from "./config";

/**
 * PROVA DE CONCEITO (IN1). Chamadas do núcleo ao Synapse, todas com o
 * `as_token` do Application Service: o usuário do núcleo (`@_guidu_core`)
 * e os usuários virtuais (`@_guidu_agent_<workspace>`) por `user_id`
 * (masquerade, só dentro do namespace exclusivo), e a API admin com o
 * próprio usuário do núcleo promovido a admin. Sem fila, sem retry, sem
 * guarda de rede: a IN3 troca isto pelo serviço de saída do núcleo.
 */

export const CONVERSATION_STATE = "chat.guidu.conversation";

export class MatrixError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`matrix ${status}: ${JSON.stringify(body)}`);
  }
}

export function mxid(config: MatrixPocConfig, localpart: string): string {
  return `@${localpart}:${config.serverName}`;
}

export function coreUserId(config: MatrixPocConfig): string {
  return mxid(config, config.asSender);
}

/** Usuário virtual do agente de um workspace (namespace `@_guidu_.*`). */
export function agentUserId(config: MatrixPocConfig, workspaceSlug: string): string {
  return mxid(config, `_guidu_agent_${workspaceSlug.replace(/[^a-z0-9._=-]/g, "_")}`);
}

/** Conta Matrix de um usuário do console (uma por usuário, não por workspace). */
export function attendantUserId(config: MatrixPocConfig, userId: string): string {
  return mxid(config, `u_${userId.replace(/-/g, "")}`);
}

export async function matrixFetch<T = Record<string, unknown>>(
  config: MatrixPocConfig,
  method: string,
  path: string,
  options: Readonly<{ body?: unknown; asUser?: string }> = {},
): Promise<T> {
  const url = new URL(config.homeserverUrl + path);
  if (options.asUser) url.searchParams.set("user_id", options.asUser);
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${config.asToken}`,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) throw new MatrixError(response.status, json);
  return json as T;
}

const enc = encodeURIComponent;

/** Registra um usuário do namespace do AS; ignora se já existe. */
export async function ensureVirtualUser(
  config: MatrixPocConfig,
  localpart: string,
  displayName: string,
): Promise<string> {
  try {
    await matrixFetch(config, "POST", "/_matrix/client/v3/register", {
      body: { type: "m.login.application_service", username: localpart, inhibit_login: true },
    });
  } catch (error) {
    if (!(error instanceof MatrixError && error.status === 400)) throw error;
  }
  const userId = mxid(config, localpart);
  await matrixFetch(config, "PUT", `/_matrix/client/v3/profile/${enc(userId)}/displayname`, {
    body: { displayname: displayName },
    asUser: userId,
  });
  return userId;
}

/**
 * Cria a conta do atendente pela API admin (sem senha) ou atualiza o nome.
 * O usuário do núcleo precisa ser admin (bootstrap em `ensureCoreAdmin`).
 */
export async function provisionAttendant(
  config: MatrixPocConfig,
  userId: string,
  displayName: string,
): Promise<string> {
  const id = attendantUserId(config, userId);
  const put = () =>
    matrixFetch(config, "PUT", `/_synapse/admin/v2/users/${enc(id)}`, {
      body: { displayname: displayName, admin: false, deactivated: false },
    });
  try {
    await put();
  } catch (error) {
    // Duas criações ao mesmo tempo (o React de dev monta o efeito duas
    // vezes): a segunda perde com M_USER_IN_USE e vira atualização.
    if (!(error instanceof MatrixError && error.status === 400)) throw error;
    await put();
  }
  return id;
}

/** Sala de conversa criada pelo núcleo: sem E2EE e com o evento reservado. */
export async function createConversationRoom(
  config: MatrixPocConfig,
  input: Readonly<{
    name: string;
    agent: string;
    invite: readonly string[];
  }>,
): Promise<string> {
  const { room_id } = await matrixFetch<{ room_id: string }>(
    config,
    "POST",
    "/_matrix/client/v3/createRoom",
    {
      body: {
        preset: "private_chat",
        // Sala v12 (padrão do Synapse 1.163): o criador (o núcleo) tem poder
        // máximo permanente e não pode aparecer em `users` (MSC4289).
        room_version: "12",
        name: input.name,
        visibility: "private",
        is_direct: false,
        invite: [input.agent, ...input.invite],
        initial_state: [
          {
            type: CONVERSATION_STATE,
            state_key: "",
            content: { version: 1, status: "pending", assignee: null },
          },
        ],
        power_level_content_override: {
          users: { [input.agent]: 50 },
          users_default: 0,
          events_default: 0,
          state_default: 100,
          invite: 50,
          kick: 50,
          ban: 50,
          redact: 50,
          events: {
            "m.room.encryption": 100,
            "m.room.power_levels": 100,
            "m.room.history_visibility": 100,
            "m.room.join_rules": 100,
            "m.room.name": 100,
            "m.room.topic": 100,
            "m.room.avatar": 100,
            "m.room.server_acl": 100,
            "m.room.tombstone": 100,
            "m.room.canonical_alias": 100,
            [CONVERSATION_STATE]: 50,
          },
        },
      },
    },
  );
  await matrixFetch(config, "POST", `/_matrix/client/v3/rooms/${enc(room_id)}/join`, {
    body: {},
    asUser: input.agent,
  });
  return room_id;
}

/** Põe o atendente na sala (API admin) e dá nível 50, para mudar o estado. */
export async function addAttendantToRoom(
  config: MatrixPocConfig,
  roomId: string,
  attendant: string,
): Promise<void> {
  const powerPath = `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.power_levels/`;
  const power = await matrixFetch<{ users?: Record<string, number> }>(config, "GET", powerPath);
  if ((power.users ?? {})[attendant] !== 50) {
    await matrixFetch(config, "PUT", powerPath, {
      body: { ...power, users: { ...(power.users ?? {}), [attendant]: 50 } },
    });
  }
  try {
    await matrixFetch(config, "POST", `/_synapse/admin/v1/join/${enc(roomId)}`, {
      body: { user_id: attendant },
    });
  } catch (error) {
    // Já na sala: tudo bem.
    if (!(error instanceof MatrixError && error.status === 403)) throw error;
  }
}

export async function sendText(
  config: MatrixPocConfig,
  roomId: string,
  asUser: string,
  text: string,
): Promise<string> {
  const { event_id } = await matrixFetch<{ event_id: string }>(
    config,
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${randomUUID()}`,
    { body: { msgtype: "m.text", body: text }, asUser },
  );
  return event_id;
}

export async function setTyping(
  config: MatrixPocConfig,
  roomId: string,
  asUser: string,
  typing: boolean,
): Promise<void> {
  await matrixFetch(
    config,
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/typing/${enc(asUser)}`,
    { body: { typing, timeout: 15000 }, asUser },
  );
}

export type ConversationState = Readonly<{
  version: 1;
  status: "pending" | "open" | "resolved";
  assignee: string | null;
}>;

export async function readConversationState(
  config: MatrixPocConfig,
  roomId: string,
): Promise<ConversationState | null> {
  try {
    return await matrixFetch<ConversationState>(
      config,
      "GET",
      `/_matrix/client/v3/rooms/${enc(roomId)}/state/${CONVERSATION_STATE}/`,
    );
  } catch (error) {
    if (error instanceof MatrixError && error.status === 404) return null;
    throw error;
  }
}

export async function writeConversationState(
  config: MatrixPocConfig,
  roomId: string,
  state: ConversationState,
  asUser?: string,
): Promise<void> {
  await matrixFetch(
    config,
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/${CONVERSATION_STATE}/`,
    { body: state, ...(asUser ? { asUser } : {}) },
  );
}

/** JWT HS256 curto para o login `org.matrix.login.jwt` do Synapse. */
export function signLoginJwt(
  config: MatrixPocConfig,
  localpart: string,
  displayName: string,
  ttlSeconds = 60,
): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    sub: localpart,
    name: displayName,
    iss: config.jwtIssuer,
    aud: config.jwtAudience,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  });
  const signature = createHmac("sha256", config.jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}
