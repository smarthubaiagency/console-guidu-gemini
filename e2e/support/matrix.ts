import { readFileSync } from "node:fs";

/**
 * Matrix in the e2e (IN4a): only when `MATRIX_E2E_ENV_FILE` points at the
 * variables file of a local Synapse (scripts/local/synapse.sh, whose
 * Application Service points at the app of the rig). Without it, the Inbox
 * suite is skipped and no other suite sees Matrix turned on. The consumer
 * plays the guidu.chat: an account made by the admin API, as in the
 * integration test of the IN3.
 */

export function matrixE2eEnv(): Record<string, string> | null {
  const file = process.env.MATRIX_E2E_ENV_FILE;
  if (!file) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^(MATRIX_[A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2];
  }
  return env.MATRIX_HOMESERVER_URL && env.MATRIX_AS_TOKEN ? env : null;
}

const enc = encodeURIComponent;

export type Consumer = Readonly<{ mxid: string; token: string }>;

export class MatrixConsumers {
  constructor(private readonly env: Record<string, string>) {}

  private async call<T>(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.env.MATRIX_HOMESERVER_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as T;
    if (!response.ok) {
      throw new Error(`matrix ${response.status} on ${path.split("?")[0]}`);
    }
    return json;
  }

  /** A consumer account with a display name, and its access token. */
  async create(name: string): Promise<Consumer> {
    const local = `cliente_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const mxid = `@${local}:${this.env.MATRIX_SERVER_NAME}`;
    const admin = this.env.MATRIX_AS_TOKEN!;
    await this.call("PUT", `/_synapse/admin/v2/users/${enc(mxid)}`, admin, {
      displayname: name,
    });
    const { access_token } = await this.call<{ access_token: string }>(
      "POST",
      `/_synapse/admin/v1/users/${enc(mxid)}/login`,
      admin,
      {},
    );
    return { mxid, token: access_token };
  }

  /** The consumer calls a store: a room of their own inviting its address. */
  async callStore(consumer: Consumer, address: string): Promise<string> {
    const { room_id } = await this.call<{ room_id: string }>(
      "POST",
      "/_matrix/client/v3/createRoom",
      consumer.token,
      { preset: "trusted_private_chat", is_direct: true, invite: [address] },
    );
    return room_id;
  }

  private syncs = 0;

  /**
   * Rooms the consumer was invited to. Synapse keeps the answer of an
   * identical initial sync for a while, so each call asks with a filter of
   * its own.
   */
  async invites(consumer: Consumer): Promise<string[]> {
    this.syncs += 1;
    const filter = JSON.stringify({
      room: { timeline: { limit: this.syncs } },
    });
    const sync = await this.call<{
      rooms?: { invite?: Record<string, unknown> };
    }>(
      "GET",
      `/_matrix/client/v3/sync?timeout=0&filter=${enc(filter)}`,
      consumer.token,
    );
    return Object.keys(sync.rooms?.invite ?? {});
  }

  async join(consumer: Consumer, roomId: string): Promise<void> {
    await this.call(
      "POST",
      `/_matrix/client/v3/rooms/${enc(roomId)}/join`,
      consumer.token,
      {},
    );
  }

  async send(
    consumer: Consumer,
    roomId: string,
    body: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.call(
      "PUT",
      `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/e2e${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      consumer.token,
      { msgtype: "m.text", body, ...extra },
    );
  }

  async typing(consumer: Consumer, roomId: string): Promise<void> {
    await this.call(
      "PUT",
      `/_matrix/client/v3/rooms/${enc(roomId)}/typing/${enc(consumer.mxid)}`,
      consumer.token,
      { typing: true, timeout: 20_000 },
    );
  }

  /** Text messages of the room, oldest first. */
  async messages(consumer: Consumer, roomId: string): Promise<string[]> {
    const page = await this.call<{
      chunk?: { type?: string; content?: { body?: unknown } }[];
    }>(
      "GET",
      `/_matrix/client/v3/rooms/${enc(roomId)}/messages?dir=b&limit=50`,
      consumer.token,
    );
    return (page.chunk ?? [])
      .filter((event) => event.type === "m.room.message")
      .map((event) => String(event.content?.body ?? ""))
      .reverse();
  }
}

/** Members of a room, by the admin API (the test rig's own token). */
export async function roomMembers(
  env: Record<string, string>,
  roomId: string,
): Promise<string[]> {
  const response = await fetch(
    `${env.MATRIX_HOMESERVER_URL}/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/members`,
    { headers: { authorization: `Bearer ${env.MATRIX_AS_TOKEN}` } },
  );
  if (!response.ok) throw new Error(`matrix ${response.status} on members`);
  const json = (await response.json()) as { members?: string[] };
  return json.members ?? [];
}

/**
 * Sends a text event as a user of the Application Service's namespace (what
 * the core does for the GUIDS), with extra keys in the content (GF2: the
 * mark of the specialist that wrote it).
 */
export async function sendAsNamespaceUser(
  env: Record<string, string>,
  roomId: string,
  mxid: string,
  content: Record<string, unknown>,
): Promise<void> {
  const txn = `e2e-as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(
    `${env.MATRIX_HOMESERVER_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}?user_id=${encodeURIComponent(mxid)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${env.MATRIX_AS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", ...content }),
    },
  );
  if (!response.ok) throw new Error(`matrix ${response.status} on send as`);
}
