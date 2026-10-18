import { randomBytes } from "node:crypto";

import { z } from "zod";

import { InboundEvent } from "@/core/channels/contract";
import { ChannelHttpError } from "@/core/channels/http";
import {
  downloadMetaMedia,
  MetaConfig,
  MetaSecrets,
  META_WINDOW_MS,
  sendMetaText,
  type MetaDeps,
} from "@/core/channels/meta";
import { decryptSecret } from "@/core/credentials/crypto";
import { definePlatformJob } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";

import { upsertMember } from "./accounts";
import { ensureAgentUser, joinAgent } from "./agent";
import { matrixConfig, userId as mxidOf } from "./config";
import { createConversationRoom } from "./rooms";
import {
  createSynapseClient,
  forceJoin,
  MatrixHttpError,
  registerNamespaceUser,
  REPLY_POWER,
  setUserPowers,
  type SynapseClient,
} from "./synapse";

/**
 * WhatsApp of Meta in the rooms of the core (IN7a, plano-in7.md §0 and §2).
 *
 * - The person behind a WhatsApp conversation is a contact of the
 *   workspace, by phone (`matrix_contacts`), with a user of the reserved
 *   namespace (`@_guidu_c_<16 base32>`) named after the WhatsApp profile.
 *   One room per person and store: the latest room of that person is
 *   reused whatever its status (a resolved one reopens as pending, IN6),
 *   and it talks by the number the person wrote to last.
 * - `channels.meta-inbound` takes the routed events of the Meta numbers
 *   and says them in the room as the contact (text, and the contact's
 *   files through the media repository of Synapse). The text then leaves
 *   the database: it lives in Synapse (ADR 0023, rule 6).
 * - `channels.meta-send` sends out what the team or the GUIDS says in such
 *   a room, once per Matrix event, refusing free text outside the 24-hour
 *   window of Meta.
 * Both are platform jobs of the worker, like the other jobs of the core;
 * the calls to Synapse and Meta run with the job's transaction open (the
 * debt of the IN3, accepted for the v1).
 */

export const CONTACT_LOCALPART = /^_guidu_c_[a-z2-7]{16}$/;
export const META_INBOUND_KIND = "channels.meta-inbound";
export const META_SEND_KIND = "channels.meta-send";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const BATCH = 20;
const enc = encodeURIComponent;

function newContactLocalpart(): string {
  let out = "_guidu_c_";
  for (const byte of randomBytes(16)) out += BASE32[byte & 31];
  return out;
}

type WorkspaceRef = Readonly<{ workspaceId: string; organizationId: string }>;

/** The user of a person of the workspace, registered with their name. */
export async function ensureContactUser(
  tx: ContextTransaction,
  client: SynapseClient,
  workspace: WorkspaceRef,
  phone: string,
  name: string | null,
): Promise<string> {
  const localpart = newContactLocalpart();
  await tx.$executeRaw`
    insert into public.matrix_contacts (workspace_id, organization_id, phone, localpart, mxid)
    values (${workspace.workspaceId}::uuid, ${workspace.organizationId}::uuid, ${phone},
            ${localpart}, ${mxidOf(client.config, localpart)})
    on conflict (workspace_id, phone) do nothing
  `;
  const row = await tx.matrixContact.findUniqueOrThrow({
    where: { workspaceId_phone: { workspaceId: workspace.workspaceId, phone } },
  });
  const displayName = name?.trim().slice(0, 120) || `+${phone}`;
  if (row.state !== "active" || row.displayName !== displayName) {
    await registerNamespaceUser(client, row.localpart, displayName);
    await tx.matrixContact.update({
      where: { id: row.id },
      data: { state: "active", displayName },
    });
  }
  return row.mxid;
}

type RouteAgent = Readonly<{
  agentId: string;
  name: string;
  active: boolean;
}>;

async function routeAgent(
  tx: ContextTransaction,
  connectionId: string,
  scope: string,
): Promise<RouteAgent | null> {
  const rows = await tx.$queryRaw<
    { agent_id: string; agent_name: string; agent_status: string }[]
  >`
    select agent_id, agent_name, agent_status
    from private.channel_route_agent(${connectionId}::uuid, ${scope})
  `;
  const row = rows[0];
  return row
    ? {
        agentId: row.agent_id,
        name: row.agent_name,
        active: row.agent_status === "active",
      }
    : null;
}

/**
 * The room of a person of the workspace, talking by this number: the
 * latest one, or a new one with the GUIDS of the number's route.
 */
export async function contactRoom(
  tx: ContextTransaction,
  client: SynapseClient,
  input: Readonly<{
    workspace: WorkspaceRef;
    contactMxid: string;
    name: string | null;
    phone: string;
    channelConversationId: string;
    agent: RouteAgent | null;
  }>,
): Promise<Readonly<{ roomId: string; created: boolean }>> {
  const current = await tx.matrixRoom.findFirst({
    where: {
      workspaceId: input.workspace.workspaceId,
      consumerMxid: input.contactMxid,
      state: "active",
      roomId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, roomId: true, channelConversationId: true },
  });
  if (!current?.roomId) {
    const room = await createConversationRoom(tx, client, {
      workspaceId: input.workspace.workspaceId,
      origin: "meta",
      consumerMxid: input.contactMxid,
      consumerName: input.name,
      consumerIsVirtual: true,
      consumerPhone: input.phone,
      channelConversationId: input.channelConversationId,
      agent: input.agent?.active ? input.agent : null,
    });
    return { roomId: room.roomId, created: true };
  }
  const roomId = current.roomId;
  if (current.channelConversationId !== input.channelConversationId) {
    await tx.matrixRoom.update({
      where: { id: current.id },
      data: { channelConversationId: input.channelConversationId },
    });
  }
  const ref = { roomId, ...input.workspace };
  const members = await tx.matrixRoomMember.findMany({
    where: { roomId },
    select: { userMxid: true, membership: true },
  });
  const joined = (mxid: string) =>
    members.some((m) => m.userMxid === mxid && m.membership === "join");
  if (!joined(input.contactMxid)) {
    await setUserPowers(client, roomId, { [input.contactMxid]: REPLY_POWER });
    await joinQuietly(client, roomId, input.contactMxid);
    await upsertMember(tx, ref, input.contactMxid, "join", null, REPLY_POWER);
  }
  if (input.agent?.active) {
    const agentMxid = await ensureAgentUser(
      tx,
      client,
      input.workspace,
      input.agent,
    );
    if (!joined(agentMxid)) {
      await joinAgent(client, roomId, agentMxid);
      await upsertMember(tx, ref, agentMxid, "join", null, REPLY_POWER);
    }
  }
  return { roomId, created: false };
}

async function joinQuietly(
  client: SynapseClient,
  roomId: string,
  mxid: string,
): Promise<void> {
  try {
    await forceJoin(client, roomId, mxid);
  } catch (error) {
    // Already in the room.
    if (!(error instanceof MatrixHttpError && error.status === 403)) {
      throw error;
    }
  }
}

/** A message said as a user of the reserved namespace, once per txn id. */
export async function sendAsUser(
  client: SynapseClient,
  roomId: string,
  mxid: string,
  txnId: string,
  content: Record<string, unknown>,
): Promise<string | null> {
  const { event_id } = await client.request<{ event_id?: string }>(
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${enc(txnId)}`,
    { body: content, asUser: mxid },
  );
  return typeof event_id === "string" ? event_id : null;
}

/** A file in the media repository of Synapse, uploaded as the user. */
export async function uploadMedia(
  client: SynapseClient,
  mxid: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const { content_uri } = await client.request<{ content_uri?: string }>(
    "POST",
    "/_matrix/media/v3/upload",
    { raw: { data, contentType }, asUser: mxid },
  );
  if (typeof content_uri !== "string" || !content_uri.startsWith("mxc://")) {
    throw new Error("matrix: upload without a content uri");
  }
  return content_uri;
}

const MSGTYPE = {
  image: "m.image",
  audio: "m.audio",
  video: "m.video",
  file: "m.file",
} as const;

const FILE_LABEL = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  file: "Arquivo",
} as const;

type Connection = Readonly<{
  id: string;
  workspaceId: string;
  organizationId: string;
  config: MetaConfig;
  secrets: MetaSecrets;
}>;

function connectionOf(row: {
  id: string;
  workspace_id: string;
  organization_id: string;
  config: unknown;
  encrypted_secrets: string;
}): Connection | null {
  const config = MetaConfig.safeParse(row.config);
  if (!config.success) return null;
  const secrets = MetaSecrets.safeParse(
    JSON.parse(decryptSecret(row.encrypted_secrets)),
  );
  if (!secrets.success) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    config: config.data,
    secrets: secrets.data,
  };
}

/** Says one event of a contact in the room, as the contact. */
async function sayInRoom(
  client: SynapseClient,
  roomId: string,
  contactMxid: string,
  event: InboundEvent,
  connection: Connection,
  deps: MetaDeps,
): Promise<number> {
  const message = event.message;
  if (!message) return 0;
  let said = 0;
  const txn = `meta-${event.externalId}`;
  for (const [index, file] of message.attachments.entries()) {
    const label = FILE_LABEL[file.kind];
    try {
      const media = await downloadMetaMedia(
        file.url,
        connection.secrets.accessToken,
        deps,
      );
      const mimeType =
        file.mimeType ?? media.mediaType ?? "application/octet-stream";
      const uri = await uploadMedia(client, contactMxid, media.data, mimeType);
      await sendAsUser(client, roomId, contactMxid, `${txn}-${index}`, {
        msgtype: MSGTYPE[file.kind],
        body: (index === 0 && message.text) || label,
        url: uri,
        info: { mimetype: mimeType, size: media.data.length },
      });
    } catch (error) {
      if (!(error instanceof ChannelHttpError)) throw error;
      // The file could not come: the team still sees that one was sent.
      await sendAsUser(client, roomId, contactMxid, `${txn}-${index}`, {
        msgtype: "m.text",
        body: `[${label} não recebido]${index === 0 && message.text ? ` ${message.text}` : ""}`,
      });
    }
    said += 1;
  }
  if (message.attachments.length === 0 && message.text.trim()) {
    await sendAsUser(client, roomId, contactMxid, txn, {
      msgtype: "m.text",
      body: message.text,
    });
    said += 1;
  }
  return said;
}

type PendingEvent = {
  id: string;
  connection_id: string;
  conversation_id: string | null;
  scope: string;
  payload: unknown;
  workspace_id: string;
  organization_id: string;
  config: unknown;
  encrypted_secrets: string;
};

export type InboundResult = Readonly<{
  delivered: number;
  ignored: number;
  more: boolean;
}>;

/** Takes the routed events of the Meta numbers to their rooms. */
export async function deliverMetaInbound(
  tx: ContextTransaction,
  client: SynapseClient,
  deps: MetaDeps = {},
  batch = BATCH,
): Promise<InboundResult> {
  const rows = await tx.$queryRaw<PendingEvent[]>`
    select event.id, event.connection_id, event.conversation_id, event.scope,
           event.payload, connection.workspace_id, connection.organization_id,
           connection.config, connection.encrypted_secrets
    from public.channel_inbound_events event
    join public.channel_connections connection on connection.id = event.connection_id
    where connection.kind = 'meta_whatsapp'
      and connection.status = 'active'
      and event.status = 'routed'
    order by event.received_at, event.id
    limit ${batch}
    for update of event skip locked
  `;
  let delivered = 0;
  let ignored = 0;
  const finish = (id: string, status: "dispatched" | "ignored") =>
    tx.$executeRaw`
      update public.channel_inbound_events
      set status = ${status},
          payload = case when payload ? 'message' and jsonb_typeof(payload->'message') = 'object'
                         then jsonb_set(payload, '{message,text}', '""'::jsonb)
                         else payload end
      where id = ${id}::uuid
    `;
  for (const row of rows) {
    const event = InboundEvent.safeParse(row.payload);
    const connection = connectionOf(row);
    const phone = event.success ? event.data.contact?.phone : null;
    if (
      !event.success ||
      !connection ||
      !row.conversation_id ||
      event.data.kind !== "message" ||
      event.data.sender !== "contact" ||
      !phone ||
      !/^[0-9]{6,20}$/.test(phone)
    ) {
      await finish(row.id, "ignored");
      ignored += 1;
      continue;
    }
    const info = await tx.$queryRaw<{ status: string }[]>`
      select status from private.matrix_workspace_info(${row.workspace_id}::uuid)
    `;
    const agent = await routeAgent(tx, row.connection_id, row.scope);
    if (info[0]?.status !== "active" || !agent) {
      // A blocked workspace or a number without its route: not said.
      await finish(row.id, "ignored");
      ignored += 1;
      continue;
    }
    const workspace = {
      workspaceId: row.workspace_id,
      organizationId: row.organization_id,
    };
    const name = event.data.contact?.name ?? null;
    const contactMxid = await ensureContactUser(
      tx,
      client,
      workspace,
      phone,
      name,
    );
    const { roomId } = await contactRoom(tx, client, {
      workspace,
      contactMxid,
      name,
      phone,
      channelConversationId: row.conversation_id,
      agent,
    });
    await sayInRoom(client, roomId, contactMxid, event.data, connection, deps);
    await finish(row.id, "dispatched");
    delivered += 1;
  }
  return { delivered, ignored, more: rows.length === batch };
}

export type SendResult = Readonly<{
  status: "sent" | "failed" | "skipped";
  error?: string;
}>;

const TEXT_TYPES = new Set(["m.text", "m.notice", "m.emote"]);

/**
 * Sends out one message the team or the GUIDS said in a room of a number:
 * once per event (`matrix_outbound`), only text, only within the window.
 */
export async function sendMetaOutbound(
  tx: ContextTransaction,
  client: SynapseClient,
  input: Readonly<{ roomId: string; eventId: string }>,
  deps: MetaDeps = {},
  now: Date = new Date(),
): Promise<SendResult> {
  const rows = await tx.$queryRaw<
    {
      workspace_id: string;
      organization_id: string;
      conversation_external_id: string;
      last_contact_message_at: Date | null;
      connection_id: string;
      config: unknown;
      encrypted_secrets: string;
      connection_status: string;
    }[]
  >`
    select room.workspace_id, room.organization_id,
           conversation.external_id as conversation_external_id,
           conversation.last_contact_message_at,
           connection.id as connection_id, connection.config,
           connection.encrypted_secrets, connection.status as connection_status
    from public.matrix_rooms room
    join public.channel_conversations conversation on conversation.id = room.channel_conversation_id
    join public.channel_connections connection on connection.id = conversation.connection_id
    where room.room_id = ${input.roomId} and room.state = 'active'
  `;
  const row = rows[0];
  if (!row) return { status: "skipped" };
  const inserted = await tx.$executeRaw`
    insert into public.matrix_outbound (event_id, room_id, workspace_id, organization_id, connection_id)
    values (${input.eventId}, ${input.roomId}, ${row.workspace_id}::uuid,
            ${row.organization_id}::uuid, ${row.connection_id}::uuid)
    on conflict (event_id) do nothing
  `;
  if (inserted === 0) {
    const existing = await tx.matrixOutbound.findUnique({
      where: { eventId: input.eventId },
      select: { status: true },
    });
    if (existing?.status !== "pending") return { status: "skipped" };
  }
  const fail = async (error: string): Promise<SendResult> => {
    await tx.matrixOutbound.update({
      where: { eventId: input.eventId },
      data: { status: "failed", error },
    });
    appLog.warn("channels.meta.send_failed", {
      connectionId: row.connection_id,
      error,
    });
    return { status: "failed", error };
  };
  const connection = connectionOf({
    id: row.connection_id,
    workspace_id: row.workspace_id,
    organization_id: row.organization_id,
    config: row.config,
    encrypted_secrets: row.encrypted_secrets,
  });
  if (!connection || row.connection_status !== "active") {
    return fail("connection_disabled");
  }
  const event = await client.request<{
    content?: Record<string, unknown>;
  }>(
    "GET",
    `/_matrix/client/v3/rooms/${enc(input.roomId)}/event/${enc(input.eventId)}`,
  );
  const content = event.content ?? {};
  if (
    !TEXT_TYPES.has(String(content.msgtype)) ||
    typeof content.body !== "string" ||
    !content.body.trim()
  ) {
    return fail("unsupported");
  }
  if (
    !row.last_contact_message_at ||
    now.getTime() - row.last_contact_message_at.getTime() >= META_WINDOW_MS
  ) {
    return fail("window_closed");
  }
  try {
    const externalId = await sendMetaText(
      connection.config.phone_number_id,
      connection.secrets.accessToken,
      row.conversation_external_id,
      content.body,
      deps,
    );
    await tx.matrixOutbound.update({
      where: { eventId: input.eventId },
      data: { status: "sent", externalId, sentAt: now },
    });
    return { status: "sent" };
  } catch (error) {
    if (!(error instanceof ChannelHttpError)) throw error;
    // A network failure may pass: the job tries again.
    if (error.code === "timeout" || error.code === "network") throw error;
    return fail(`meta_${error.status ?? error.code}`);
  }
}

/** What the team or the GUIDS said in a room of a number goes out. */
export async function enqueueMetaSend(
  tx: ContextTransaction,
  roomId: string,
  eventId: string,
): Promise<void> {
  await tx.$executeRaw`
    insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts)
    values (${META_SEND_KIND}, 'platform',
            ${JSON.stringify({ roomId, eventId })}::jsonb,
            ${`${META_SEND_KIND}:${eventId}`.slice(0, 200)}, 3)
    on conflict do nothing
  `;
}

function client(): SynapseClient {
  const config = matrixConfig();
  if (!config) throw new SkipJobError("Matrix não configurado.");
  return createSynapseClient(config);
}

export const metaInboundJob = definePlatformJob<Record<string, never>>({
  kind: META_INBOUND_KIND,
  description:
    "Leva as mensagens do WhatsApp da Meta para as salas do Inbox, como o contato.",
  payload: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  maxAttempts: 5,
  retryDelaySeconds: 15,
  async run(tx) {
    const result = await deliverMetaInbound(tx, client());
    if (result.more) {
      await tx.$executeRaw`
        insert into public.job_runs (kind, scope, payload, idempotency_key, max_attempts)
        values (${META_INBOUND_KIND}, 'platform', '{}'::jsonb,
                ${`${META_INBOUND_KIND}:${randomBytes(8).toString("hex")}`}, 5)
      `;
    }
    return { delivered: result.delivered, ignored: result.ignored };
  },
});

export const metaSendJob = definePlatformJob<{
  roomId: string;
  eventId: string;
}>({
  kind: META_SEND_KIND,
  description:
    "Envia pelo WhatsApp da Meta o que a equipe ou o GUIDS escreveu na sala.",
  payload: z
    .object({
      roomId: z.string().regex(/^![^\s]{1,254}$/),
      eventId: z.string().regex(/^\$[^\s]{1,254}$/),
    })
    .strict(),
  maxAttempts: 3,
  retryDelaySeconds: 20,
  async run(tx, payload) {
    const result = await sendMetaOutbound(tx, client(), payload);
    return { status: result.status, error: result.error ?? null };
  },
});

export const metaJobs = [metaInboundJob, metaSendJob] as const;
