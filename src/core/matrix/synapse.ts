import type { MatrixConfig } from "./config";

/**
 * Calls of the core to Synapse (IN3), all with the `as_token`: the core
 * user (the Application Service sender, promoted to admin once) for the
 * Client-Server and admin APIs, and the users of the reserved namespace by
 * `user_id` (ADR 0023, rule 8). The homeserver address is the operator's,
 * not a customer's, so plain fetch with a time limit is enough.
 */

export const CONVERSATION_STATE = "chat.guidu.conversation";
export const CONVERSATION_STATUSES = ["open", "pending", "resolved"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * Powers in a conversation room (IN4a, decision of 17/10/2026): the state
 * of the conversation, invites and kicks at 50, for the core (creator) and
 * the agent; sending at 10, for the attendants who answer and for the
 * consumer; 0 for who only reads (an owner or admin who is not an
 * attendant). The attendants change the state through the console, which
 * checks their permission and writes it as the core.
 */
export const STATE_POWER = 50;
export const REPLY_POWER = 10;
export const READ_POWER = 0;

export type InboxAccess = "reply" | "read";

export function powerOf(access: InboxAccess): number {
  return access === "reply" ? REPLY_POWER : READ_POWER;
}

export class MatrixHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errcode: string | null,
    readonly path: string,
  ) {
    super(`matrix ${status} ${errcode ?? ""} on ${path}`.trim());
    this.name = "MatrixHttpError";
  }
}

export type MatrixFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type SynapseClient = Readonly<{
  config: MatrixConfig;
  request<T = Record<string, unknown>>(
    method: string,
    path: string,
    options?: Readonly<{
      body?: unknown;
      asUser?: string;
      query?: Record<string, string>;
    }>,
  ): Promise<T>;
}>;

const TIMEOUT_MS = 10_000;
const enc = encodeURIComponent;

export function createSynapseClient(
  config: MatrixConfig,
  fetchImpl: MatrixFetch = (input, init) => fetch(input, init),
): SynapseClient {
  return {
    config,
    async request<T>(
      method: string,
      path: string,
      options: Readonly<{
        body?: unknown;
        asUser?: string;
        query?: Record<string, string>;
      }> = {},
    ): Promise<T> {
      const url = new URL(config.homeserverUrl + path);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        url.searchParams.set(key, value);
      }
      if (options.asUser) url.searchParams.set("user_id", options.asUser);
      const response = await fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${config.asToken}`,
          ...(options.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : null,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await response.text();
      let json: unknown = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (!response.ok) {
        const errcode =
          json &&
          typeof json === "object" &&
          "errcode" in json &&
          typeof json.errcode === "string"
            ? json.errcode
            : null;
        // The path only: never the query, which may carry a user id.
        throw new MatrixHttpError(
          response.status,
          errcode,
          path.split("?")[0] ?? path,
        );
      }
      return json as T;
    },
  };
}

function isError(error: unknown, status: number, errcode?: string): boolean {
  return (
    error instanceof MatrixHttpError &&
    error.status === status &&
    (errcode === undefined || error.errcode === errcode)
  );
}

// ---------------------------------------------------------------------------
// Accounts (admin API)
// ---------------------------------------------------------------------------

/**
 * Creates or updates an attendant account, without a password, and brings
 * a deactivated one back. Two creations at once lose with M_USER_IN_USE;
 * the second becomes an update (prova-de-conceito.md §2).
 */
export async function upsertUser(
  client: SynapseClient,
  mxid: string,
  displayName: string,
): Promise<void> {
  const put = () =>
    client.request("PUT", `/_synapse/admin/v2/users/${enc(mxid)}`, {
      body: { displayname: displayName, deactivated: false, admin: false },
    });
  try {
    await put();
  } catch (error) {
    if (!isError(error, 400)) throw error;
    await put();
  }
}

/** Deactivates an account: Synapse also takes it out of every room. */
export async function deactivateUser(
  client: SynapseClient,
  mxid: string,
): Promise<void> {
  try {
    await client.request("POST", `/_synapse/admin/v1/deactivate/${enc(mxid)}`, {
      body: { erase: false },
    });
  } catch (error) {
    if (isError(error, 404)) return;
    throw error;
  }
}

/** Ends every Matrix session of a person (sign-out of the console). */
export async function deleteAllDevices(
  client: SynapseClient,
  mxid: string,
): Promise<number> {
  let devices: { device_id?: string }[] = [];
  try {
    const listed = await client.request<{ devices?: { device_id?: string }[] }>(
      "GET",
      `/_synapse/admin/v2/users/${enc(mxid)}/devices`,
    );
    devices = listed.devices ?? [];
  } catch (error) {
    if (isError(error, 404)) return 0;
    throw error;
  }
  const ids = devices
    .map((d) => d.device_id)
    .filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return 0;
  await client.request(
    "POST",
    `/_synapse/admin/v2/users/${enc(mxid)}/delete_devices`,
    {
      body: { devices: ids },
    },
  );
  return ids.length;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type PowerLevels = Readonly<{
  users?: Record<string, number>;
  [key: string]: unknown;
}>;

/**
 * Body of a conversation room (prova-de-conceito.md, "Conclusão" 3): room
 * v12 with the core as creator (permanent top power, never in `users`), no
 * guest access, no encryption (only power 100 may turn it on), the power
 * levels at 100 and the conversation state at 50, pending and unassigned.
 */
export function conversationRoomBody(
  input: Readonly<{
    name?: string | null;
    /** Power of each member other than the core (attendants, consumer). */
    powers?: Readonly<Record<string, number>>;
  }> = {},
): Record<string, unknown> {
  const users: Record<string, number> = {};
  for (const [mxid, power] of Object.entries(input.powers ?? {})) {
    if (power > 0) users[mxid] = power;
  }
  return {
    preset: "private_chat",
    room_version: "12",
    visibility: "private",
    is_direct: false,
    ...(input.name ? { name: input.name } : {}),
    invite: [],
    initial_state: [
      {
        type: CONVERSATION_STATE,
        state_key: "",
        content: { version: 1, status: "pending", assignee: null },
      },
      {
        type: "m.room.guest_access",
        state_key: "",
        content: { guest_access: "forbidden" },
      },
    ],
    power_level_content_override: {
      users,
      users_default: READ_POWER,
      events_default: REPLY_POWER,
      state_default: 100,
      invite: STATE_POWER,
      kick: STATE_POWER,
      ban: STATE_POWER,
      redact: STATE_POWER,
      events: {
        "m.room.encryption": 100,
        "m.room.power_levels": 100,
        "m.room.history_visibility": 100,
        "m.room.join_rules": 100,
        "m.room.guest_access": 100,
        "m.room.name": 100,
        "m.room.topic": 100,
        "m.room.avatar": 100,
        "m.room.server_acl": 100,
        "m.room.tombstone": 100,
        "m.room.canonical_alias": 100,
        [CONVERSATION_STATE]: STATE_POWER,
      },
    },
  };
}

export async function createRoom(
  client: SynapseClient,
  input: Readonly<{
    name?: string | null;
    powers?: Readonly<Record<string, number>>;
  }> = {},
): Promise<string> {
  const { room_id } = await client.request<{ room_id: string }>(
    "POST",
    "/_matrix/client/v3/createRoom",
    { body: conversationRoomBody(input) },
  );
  if (typeof room_id !== "string")
    throw new MatrixHttpError(502, null, "/createRoom");
  return room_id;
}

const powerPath = (roomId: string) =>
  `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.power_levels/`;

/** Sets the power of some users (null or 0 removes them), in one state event. */
export async function setUserPowers(
  client: SynapseClient,
  roomId: string,
  changes: Readonly<Record<string, number | null>>,
): Promise<void> {
  const current = await client.request<PowerLevels>("GET", powerPath(roomId));
  const users = { ...(current.users ?? {}) };
  let changed = false;
  for (const [user, level] of Object.entries(changes)) {
    if (level === null || level === 0) {
      if (user in users) {
        delete users[user];
        changed = true;
      }
    } else if (users[user] !== level) {
      users[user] = level;
      changed = true;
    }
  }
  if (!changed) return;
  await client.request("PUT", powerPath(roomId), {
    body: { ...current, users },
  });
}

/** Puts a local user in a room without an invite (admin API). */
export async function forceJoin(
  client: SynapseClient,
  roomId: string,
  mxid: string,
): Promise<void> {
  await client.request("POST", `/_synapse/admin/v1/join/${enc(roomId)}`, {
    body: { user_id: mxid },
  });
}

/** Takes someone out of a room; nothing to do when they are not in it. */
export async function kick(
  client: SynapseClient,
  roomId: string,
  mxid: string,
  reason: string,
): Promise<boolean> {
  try {
    await client.request(
      "POST",
      `/_matrix/client/v3/rooms/${enc(roomId)}/kick`,
      {
        body: { user_id: mxid, reason },
      },
    );
    return true;
  } catch (error) {
    // Not a member (or already gone): Synapse answers 403.
    if (isError(error, 403) || isError(error, 404)) return false;
    throw error;
  }
}

export async function invite(
  client: SynapseClient,
  roomId: string,
  mxid: string,
): Promise<void> {
  await client.request(
    "POST",
    `/_matrix/client/v3/rooms/${enc(roomId)}/invite`,
    {
      body: { user_id: mxid },
    },
  );
}

/** Leaves (or refuses the invite of) a room as a namespace user. */
export async function leaveAs(
  client: SynapseClient,
  roomId: string,
  asUser: string,
  reason: string,
): Promise<void> {
  try {
    await client.request(
      "POST",
      `/_matrix/client/v3/rooms/${enc(roomId)}/leave`,
      {
        body: { reason },
        asUser,
      },
    );
  } catch (error) {
    if (isError(error, 403) || isError(error, 404)) return;
    throw error;
  }
}

/**
 * Deletes a room with purge (admin API, asynchronous on Synapse). An unknown
 * room counts as deleted, so a repeated purge is harmless.
 */
export async function deleteRoom(
  client: SynapseClient,
  roomId: string,
): Promise<boolean> {
  try {
    await client.request("DELETE", `/_synapse/admin/v2/rooms/${enc(roomId)}`, {
      body: { purge: true, block: false },
    });
    return true;
  } catch (error) {
    if (isError(error, 404) || isError(error, 400)) return false;
    throw error;
  }
}

export type AdminRoom = Readonly<{ room_id: string; creator?: string | null }>;

/** One page of the rooms of the server (admin API). */
export async function listRooms(
  client: SynapseClient,
  from: number,
  limit = 100,
): Promise<{ rooms: AdminRoom[]; next: number | null }> {
  const page = await client.request<{
    rooms?: AdminRoom[];
    next_batch?: number;
  }>("GET", "/_synapse/admin/v1/rooms", {
    query: { from: String(from), limit: String(limit), order_by: "name" },
  });
  return {
    rooms: page.rooms ?? [],
    next: typeof page.next_batch === "number" ? page.next_batch : null,
  };
}

/** When the room was created (its `m.room.create`), or null. */
export async function roomCreatedAt(
  client: SynapseClient,
  roomId: string,
): Promise<number | null> {
  try {
    const { state } = await client.request<{
      state?: { type?: string; origin_server_ts?: number }[];
    }>("GET", `/_synapse/admin/v1/rooms/${enc(roomId)}/state`);
    const create = (state ?? []).find(
      (event) => event.type === "m.room.create",
    );
    return typeof create?.origin_server_ts === "number"
      ? create.origin_server_ts
      : null;
  } catch (error) {
    if (isError(error, 404) || isError(error, 400)) return null;
    throw error;
  }
}

/**
 * Writes the conversation state as the core (IN4a). The console checks who
 * may change it; the room keeps it and the core mirrors it from the
 * Application Service.
 */
export async function setConversationState(
  client: SynapseClient,
  roomId: string,
  state: Readonly<{ status: ConversationStatus; assignee: string | null }>,
): Promise<string | null> {
  const { event_id } = await client.request<{ event_id?: string }>(
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/${CONVERSATION_STATE}/`,
    { body: { version: 1, status: state.status, assignee: state.assignee } },
  );
  return typeof event_id === "string" ? event_id : null;
}

/**
 * Registers a user of the reserved namespace (the address of a workspace,
 * IN4a) and sets its name. Registering again is harmless.
 */
export async function registerNamespaceUser(
  client: SynapseClient,
  localpart: string,
  displayName: string,
): Promise<void> {
  try {
    await client.request("POST", "/_matrix/client/v3/register", {
      body: {
        type: "m.login.application_service",
        username: localpart,
        inhibit_login: true,
      },
    });
  } catch (error) {
    if (!isError(error, 400, "M_USER_IN_USE")) throw error;
  }
  const mxid = `@${localpart}:${client.config.serverName}`;
  await client.request(
    "PUT",
    `/_matrix/client/v3/profile/${enc(mxid)}/displayname`,
    { body: { displayname: displayName }, asUser: mxid },
  );
}

/** Display name of a user, or null. */
export async function displayNameOf(
  client: SynapseClient,
  mxid: string,
): Promise<string | null> {
  try {
    const profile = await client.request<{ displayname?: unknown }>(
      "GET",
      `/_matrix/client/v3/profile/${enc(mxid)}/displayname`,
    );
    return typeof profile.displayname === "string" && profile.displayname
      ? profile.displayname.slice(0, 255)
      : null;
  } catch (error) {
    if (isError(error, 404)) return null;
    throw error;
  }
}
