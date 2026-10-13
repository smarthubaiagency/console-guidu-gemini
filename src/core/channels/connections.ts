import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@/core/credentials/crypto";
import { Permissions } from "@/core/permissions/catalog";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import {
  type ChatwootAccount,
  ChatwootConfig,
  type ChatwootInbox,
  ChatwootSecrets,
  checkChatwoot,
  createAgentBot,
  deleteAgentBot,
  setInboxAgentBot,
} from "./chatwoot";
import type { ChannelKind } from "./contract";
import { type ChannelFetch, ChannelHttpError, providerOrigin } from "./http";
import {
  type ServiceConfig,
  ServiceSettings,
  serviceConfigOf,
} from "./settings";
import { newWebhookToken, webhookPath } from "./webhook";

/**
 * Connections of the workspace to messaging providers (A5a, ADR 0011,
 * decision 8): `channels.read` lists them, `channels.manage` creates,
 * checks and removes them, with audit and never the secrets' value.
 *
 * A Chatwoot connection is made in one step: with the address, the account
 * and an administrator's access token, the core creates the account's
 * Agent Bot pointing at the connection's webhook and keeps the bot's token
 * to answer as the bot. The calls to the provider run outside any
 * transaction.
 */

export type ChannelDeps = Readonly<{
  fetch?: ChannelFetch;
  /** Public origin of the app, where the provider posts its events. */
  appUrl?: string;
}>;

export type ChannelConnectionDto = Readonly<{
  id: string;
  kind: ChannelKind;
  name: string;
  status: "active" | "disabled";
  baseUrl: string | null;
  accountId: number | null;
  inboxes: readonly ChatwootInbox[];
  /** Service settings of the integration (A5b). */
  service: ServiceConfig;
  maskedSecret: string;
  healthStatus: "unknown" | "ok" | "failed";
  healthError: string | null;
  healthCheckedAt: string | null;
  lastEventAt: string | null;
  /** Events written without an owner of their scope (no route). */
  unroutedEvents: number;
  /** Service of the last 7 days (A5c, health of the connection). */
  activity: ChannelActivity;
  createdAt: string;
}>;

export type ChannelActivity = Readonly<{
  sent: number;
  failedDeliveries: number;
  /** Contact messages whose answer failed (the consumer did not answer). */
  failedEvents: number;
  lastSentAt: string | null;
  /** Code of the last failed delivery, as in `channels.health`. */
  lastDeliveryError: string | null;
}>;

/** Window of the activity shown on a connection. */
export const ACTIVITY_DAYS = 7;

const NO_ACTIVITY: ChannelActivity = {
  sent: 0,
  failedDeliveries: 0,
  failedEvents: 0,
  lastSentAt: null,
  lastDeliveryError: null,
};

export const ChatwootConnectionInput = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, { error: "Informe um nome." })
    .max(80, { error: "Use até 80 caracteres." }),
  baseUrl: z
    .string()
    .trim()
    .min(1, { error: "Informe o endereço do Chatwoot." })
    .max(300),
  accountId: z.coerce
    .number({ error: "Informe o número da conta." })
    .int({ error: "Informe o número da conta." })
    .positive({ error: "Informe o número da conta." }),
  accessToken: z
    .string()
    .trim()
    .min(8, { error: "Informe o token de acesso." })
    .max(200),
});

export class ChannelInputError extends AppError {
  constructor(readonly fieldErrors: Record<string, string>) {
    super({
      code: "invalid_input",
      safeMessage: "Revise os campos destacados.",
      messageKey: "channels.errors.invalidInput",
    });
  }
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Conexão não encontrada.",
    messageKey: "apiErrors.notFound",
  });
}

/** The provider did not accept the call; `code` says why, without secrets. */
export class ChannelProviderError extends AppError {
  constructor(readonly providerCode: string) {
    super({
      code: "provider_error",
      safeMessage: "O Chatwoot não aceitou a conexão.",
      messageKey: `channels.errors.provider.${providerCode}`,
    });
  }
}

function origin(ctx: RequestContext): "api" | "app" {
  return ctx.principalType === "api_key" ? "api" : "app";
}

function appOrigin(deps: ChannelDeps): string {
  const raw = (deps.appUrl ?? process.env.APP_URL ?? "").trim();
  try {
    return new URL(raw).origin;
  } catch {
    throw new AppError({
      code: "internal",
      safeMessage: "O endereço público do GUIDU não está configurado.",
    });
  }
}

function accountOf(config: ChatwootConfig): ChatwootAccount {
  return { baseUrl: config.base_url, accountId: config.account_id };
}

function secretsOf(encrypted: string): ChatwootSecrets {
  return ChatwootSecrets.parse(JSON.parse(decryptSecret(encrypted)));
}

type Row = Awaited<
  ReturnType<ContextTransaction["channelConnection"]["findFirst"]>
> & {};

function toDto(
  row: Row,
  unroutedEvents: number,
  activity: ChannelActivity = NO_ACTIVITY,
): ChannelConnectionDto {
  const config = ChatwootConfig.safeParse(row.config);
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    name: row.name,
    status: row.status as ChannelConnectionDto["status"],
    baseUrl: config.success ? config.data.base_url : null,
    accountId: config.success ? config.data.account_id : null,
    inboxes: config.success ? config.data.inboxes : [],
    service: serviceConfigOf(row.config),
    maskedSecret: row.maskedSecret,
    healthStatus: row.healthStatus as ChannelConnectionDto["healthStatus"],
    healthError: row.healthError,
    healthCheckedAt: row.healthCheckedAt?.toISOString() ?? null,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    unroutedEvents,
    activity,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadRow(
  tx: ContextTransaction,
  ctx: RequestContext,
  connectionId: string,
) {
  if (!z.uuid().safeParse(connectionId).success) throw notFound();
  const row = await tx.channelConnection.findFirst({
    where: { id: connectionId, workspaceId: ctx.workspaceId },
  });
  if (!row) throw notFound();
  return row;
}

export async function listChannelConnections(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<ChannelConnectionDto[]> {
  await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_READ);
  const rows = await tx.channelConnection.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const unrouted = await tx.channelInboundEvent.groupBy({
    by: ["connectionId"],
    where: { workspaceId: ctx.workspaceId, status: "no_route" },
    _count: { _all: true },
  });
  const counts = new Map(
    unrouted.map((row) => [row.connectionId, row._count._all]),
  );
  const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000);
  const [deliveries, failedEvents, lastErrors] = await Promise.all([
    tx.channelDelivery.groupBy({
      by: ["connectionId", "status"],
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
      _count: { _all: true },
      _max: { sentAt: true },
    }),
    tx.channelInboundEvent.groupBy({
      by: ["connectionId"],
      where: {
        workspaceId: ctx.workspaceId,
        status: "failed",
        receivedAt: { gte: since },
      },
      _count: { _all: true },
    }),
    tx.channelDelivery.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: "failed",
        createdAt: { gte: since },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["connectionId"],
      select: { connectionId: true, error: true },
    }),
  ]);
  const activityOf = (connectionId: string): ChannelActivity => {
    const sent = deliveries.find(
      (d) => d.connectionId === connectionId && d.status === "sent",
    );
    const failed = deliveries.find(
      (d) => d.connectionId === connectionId && d.status === "failed",
    );
    return {
      sent: sent?._count._all ?? 0,
      failedDeliveries: failed?._count._all ?? 0,
      failedEvents:
        failedEvents.find((e) => e.connectionId === connectionId)?._count
          ._all ?? 0,
      lastSentAt: sent?._max.sentAt?.toISOString() ?? null,
      lastDeliveryError:
        lastErrors.find((e) => e.connectionId === connectionId)?.error ?? null,
    };
  };
  return rows.map((row) =>
    toDto(row, counts.get(row.id) ?? 0, activityOf(row.id)),
  );
}

/**
 * Creates a Chatwoot connection: the Agent Bot of the account with the
 * connection's webhook, then the row with the tokens encrypted. If the row
 * cannot be written, the bot just created is removed.
 */
export async function createChatwootConnection(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: unknown,
  deps: ChannelDeps = {},
): Promise<ChannelConnectionDto> {
  await withContext(prisma, ctx, (tx) =>
    requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE),
  );
  const parsed = ChatwootConnectionInput.safeParse(input);
  if (!parsed.success) {
    throw new ChannelInputError(
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "form"),
          issue.message,
        ]),
      ),
    );
  }
  let baseUrl: string;
  try {
    baseUrl = providerOrigin(parsed.data.baseUrl);
  } catch {
    throw new ChannelInputError({
      baseUrl: "Use o endereço https do seu Chatwoot.",
    });
  }
  const account = { baseUrl, accountId: parsed.data.accountId };
  const id = randomUUID();
  const webhook = newWebhookToken();
  const outgoingUrl = `${appOrigin(deps)}${webhookPath(id, webhook.token)}`;

  let bot: { id: number; accessToken: string };
  try {
    bot = await createAgentBot(
      account,
      parsed.data.accessToken,
      { name: `GUIDU · ${parsed.data.name}`, outgoingUrl },
      deps,
    );
  } catch (error) {
    if (error instanceof ChannelHttpError) {
      appLog.warn("channels.connection.create_failed", {
        code: error.code,
        status: error.status,
      });
      throw new ChannelProviderError(error.code);
    }
    throw error;
  }

  const secrets: ChatwootSecrets = {
    userToken: parsed.data.accessToken,
    botToken: bot.accessToken,
  };
  const { encryptedPayload } = encryptSecret(JSON.stringify(secrets));
  const config: ChatwootConfig = {
    base_url: baseUrl,
    account_id: account.accountId,
    agent_bot_id: bot.id,
    inboxes: [],
  };
  let row: { id: string };
  try {
    row = await withContext(prisma, ctx, async (tx) => {
      await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
      const created = await tx.channelConnection.create({
        data: {
          id,
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          kind: "chatwoot",
          name: parsed.data.name,
          config,
          encryptedSecrets: encryptedPayload,
          maskedSecret: maskSecret(parsed.data.accessToken),
          webhookTokenHash: webhook.hash,
          createdBy: ctx.userId,
        },
      });
      await recordAudit(tx, ctx, {
        action: "channels.connection.create",
        resourceType: "channel_connection",
        resourceId: created.id,
        result: "success",
        origin: origin(ctx),
        metadata: {
          kind: "chatwoot",
          name: created.name,
          baseUrl,
          accountId: account.accountId,
          agentBotId: bot.id,
        },
      });
      return created;
    });
  } catch (error) {
    await deleteAgentBot(account, secrets.userToken, bot.id, deps).catch(
      () => undefined,
    );
    throw error;
  }
  return checkChannelConnection(prisma, ctx, row.id, deps);
}

/**
 * Checks the connection with the provider and keeps the result and the
 * inboxes seen (Chatwoot), for the screens and the A5b.
 */
export async function checkChannelConnection(
  prisma: PrismaClient,
  ctx: RequestContext,
  connectionId: string,
  deps: ChannelDeps = {},
): Promise<ChannelConnectionDto> {
  const row = await withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
    return loadRow(tx, ctx, connectionId);
  });
  const config = ChatwootConfig.parse(row.config);
  const health = await checkChatwoot(
    accountOf(config),
    secretsOf(row.encryptedSecrets),
    config.agent_bot_id,
    deps,
  );
  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
    const updated = await tx.channelConnection.update({
      where: { id: row.id },
      data: {
        healthStatus: health.ok ? "ok" : "failed",
        healthError: health.code,
        healthCheckedAt: new Date(),
        updatedBy: ctx.userId,
        ...(health.ok
          ? { config: { ...config, inboxes: health.inboxes } }
          : {}),
      },
    });
    await recordAudit(tx, ctx, {
      action: "channels.connection.check",
      resourceType: "channel_connection",
      resourceId: row.id,
      result: health.ok ? "success" : "error",
      origin: origin(ctx),
      metadata: {
        kind: row.kind,
        reason: health.code ?? "",
        inboxes: health.inboxes.length,
      },
    });
    const unrouted = await tx.channelInboundEvent.count({
      where: { connectionId: row.id, status: "no_route" },
    });
    return toDto(updated, unrouted);
  });
}

/**
 * Removes the connection: the Agent Bot leaves the account (best effort:
 * a bot already gone is fine) and the row goes with its routes, external
 * conversations and events.
 */
export async function deleteChannelConnection(
  prisma: PrismaClient,
  ctx: RequestContext,
  connectionId: string,
  deps: ChannelDeps = {},
): Promise<void> {
  const row = await withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
    return loadRow(tx, ctx, connectionId);
  });
  const config = ChatwootConfig.safeParse(row.config);
  let botRemoved = false;
  if (config.success) {
    try {
      await deleteAgentBot(
        accountOf(config.data),
        secretsOf(row.encryptedSecrets).userToken,
        config.data.agent_bot_id,
        deps,
      );
      botRemoved = true;
    } catch (error) {
      if (!(error instanceof ChannelHttpError)) throw error;
      botRemoved = error.code === "not_found";
      appLog.warn("channels.connection.bot_not_removed", {
        connectionId: row.id,
        code: error.code,
      });
    }
  }
  await withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
    await tx.channelConnection.delete({ where: { id: row.id } });
    await recordAudit(tx, ctx, {
      action: "channels.connection.delete",
      resourceType: "channel_connection",
      resourceId: row.id,
      result: "success",
      origin: origin(ctx),
      metadata: { kind: row.kind, name: row.name, botRemoved },
    });
  });
}

// ---------------------------------------------------------------------------
// Service settings of the integration (A5b)
// ---------------------------------------------------------------------------

export const ServiceSettingsInput = z.strictObject({
  connectionId: z.uuid(),
  /** An inbox; absent: the defaults of every inbox. */
  scope: z.string().trim().min(1).max(200).nullable(),
  /** Null with a scope: back to the defaults. */
  settings: ServiceSettings.nullable(),
});

/**
 * Saves the service settings of a connection, for every inbox or for one
 * (decided by Marcelo on 13/10/2026: they live in the integration).
 */
export async function updateServiceSettings(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<ChannelConnectionDto> {
  await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
  const parsed = ServiceSettingsInput.safeParse(input);
  if (!parsed.success) {
    throw new ChannelInputError(
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path.at(-1) ?? "form"),
          "Valor fora do permitido.",
        ]),
      ),
    );
  }
  const { connectionId, scope, settings } = parsed.data;
  const row = await loadRow(tx, ctx, connectionId);
  const config = ChatwootConfig.parse(row.config);
  if (scope !== null && !config.inboxes.some((i) => String(i.id) === scope)) {
    throw notFound();
  }
  if (scope === null && settings === null) {
    throw new ChannelInputError({ form: "Informe as configurações." });
  }
  const service = serviceConfigOf(config);
  const inboxes = { ...service.inboxes };
  if (scope === null) {
    service.defaults = settings ?? {};
  } else if (settings === null) {
    delete inboxes[scope];
  } else {
    inboxes[scope] = settings;
  }
  const updated = await tx.channelConnection.update({
    where: { id: row.id },
    data: {
      config: { ...config, service: { defaults: service.defaults, inboxes } },
      updatedBy: ctx.userId,
    },
  });
  await recordAudit(tx, ctx, {
    action: "channels.connection.settings",
    resourceType: "channel_connection",
    resourceId: row.id,
    result: "success",
    origin: origin(ctx),
    metadata: {
      kind: row.kind,
      target: scope ?? "defaults",
      to: settings ?? "defaults",
    },
  });
  const unrouted = await tx.channelInboundEvent.count({
    where: { connectionId: row.id, status: "no_route" },
  });
  return toDto(updated, unrouted);
}

// ---------------------------------------------------------------------------
// Routes: which consumer answers an inbox (A5b)
// ---------------------------------------------------------------------------

export type ChannelInboxDto = Readonly<{
  connectionId: string;
  connectionName: string;
  kind: ChannelKind;
  inboxId: string;
  inboxName: string;
  channelType: string | null;
  route: Readonly<{
    id: string;
    consumerModule: string;
    consumerRef: string;
  }> | null;
}>;

/** Every inbox of the workspace's active connections, with its route. */
export async function listChannelInboxes(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<ChannelInboxDto[]> {
  await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_READ);
  const [connections, routes] = await Promise.all([
    tx.channelConnection.findMany({
      where: { workspaceId: ctx.workspaceId, status: "active" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.channelRoute.findMany({
      where: { workspaceId: ctx.workspaceId, status: "active" },
      select: {
        id: true,
        connectionId: true,
        scope: true,
        consumerModule: true,
        consumerRef: true,
      },
    }),
  ]);
  return connections.flatMap((connection) => {
    const config = ChatwootConfig.safeParse(connection.config);
    if (!config.success) return [];
    return config.data.inboxes.map((inbox) => {
      const route = routes.find(
        (r) => r.connectionId === connection.id && r.scope === String(inbox.id),
      );
      return {
        connectionId: connection.id,
        connectionName: connection.name,
        kind: connection.kind as ChannelKind,
        inboxId: String(inbox.id),
        inboxName: inbox.name,
        channelType: inbox.channel_type,
        route: route
          ? {
              id: route.id,
              consumerModule: route.consumerModule,
              consumerRef: route.consumerRef,
            }
          : null,
      };
    });
  });
}

export const OpenRouteInput = z.strictObject({
  connectionId: z.uuid(),
  scope: z.string().trim().min(1).max(200),
  consumerModule: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  consumerRef: z.uuid(),
});
export type OpenRouteInput = z.infer<typeof OpenRouteInput>;

function inboxTaken(): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: "Esta inbox já é atendida por outro agente.",
    messageKey: "channels.errors.inboxTaken",
  });
}

/**
 * Gives an inbox to a consumer: the route (one active per inbox, unique in
 * the database) and the account's bot on the inbox in Chatwoot. The person
 * who opens it is who the dispatch runs as. The caller checks its own
 * module's permission first.
 */
export async function openChannelRoute(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: OpenRouteInput,
  deps: ChannelDeps = {},
): Promise<{ id: string }> {
  const parsed = OpenRouteInput.parse(input);
  const { row, route } = await withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
    const row = await loadRow(tx, ctx, parsed.connectionId);
    if (row.status !== "active") throw notFound();
    const config = ChatwootConfig.parse(row.config);
    if (!config.inboxes.some((i) => String(i.id) === parsed.scope)) {
      throw notFound();
    }
    const taken = await tx.channelRoute.findFirst({
      where: {
        connectionId: row.id,
        scope: parsed.scope,
        status: "active",
      },
      select: { id: true },
    });
    if (taken) throw inboxTaken();
    let route: { id: string };
    try {
      route = await tx.channelRoute.create({
        data: {
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          connectionId: row.id,
          scope: parsed.scope,
          consumerModule: parsed.consumerModule,
          consumerRef: parsed.consumerRef,
          createdBy: ctx.userId,
        },
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw inboxTaken();
      }
      throw error;
    }
    await recordAudit(tx, ctx, {
      action: "channels.route.open",
      resourceType: "channel_route",
      resourceId: route.id,
      result: "success",
      origin: origin(ctx),
      metadata: {
        kind: row.kind,
        target: parsed.scope,
        agentId: parsed.consumerRef,
      },
    });
    return { row, route };
  });
  const config = ChatwootConfig.parse(row.config);
  try {
    await setInboxAgentBot(
      accountOf(config),
      secretsOf(row.encryptedSecrets).userToken,
      parsed.scope,
      config.agent_bot_id,
      deps,
    );
  } catch (error) {
    if (!(error instanceof ChannelHttpError)) throw error;
    // Without the bot on the inbox nothing arrives: the route goes away.
    await withContext(prisma, ctx, (tx) =>
      tx.channelRoute.update({
        where: { id: route.id },
        data: { status: "closed", updatedBy: ctx.userId },
      }),
    );
    throw new ChannelProviderError(error.code);
  }
  return route;
}

/**
 * Takes an inbox back from its consumer: the route is closed and the bot
 * leaves the inbox in Chatwoot (best effort: the route decides). With
 * `consumerRef`, only that consumer's routes.
 */
export async function closeChannelRoutes(
  prisma: PrismaClient,
  ctx: RequestContext,
  where: Readonly<{
    consumerModule: string;
    consumerRef: string;
    routeId?: string;
  }>,
  deps: ChannelDeps = {},
): Promise<number> {
  const closed = await withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
    const routes = await tx.channelRoute.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: "active",
        consumerModule: where.consumerModule,
        consumerRef: where.consumerRef,
        ...(where.routeId ? { id: where.routeId } : {}),
      },
    });
    const rows = [];
    for (const route of routes) {
      await tx.channelRoute.update({
        where: { id: route.id },
        data: { status: "closed", updatedBy: ctx.userId },
      });
      await recordAudit(tx, ctx, {
        action: "channels.route.close",
        resourceType: "channel_route",
        resourceId: route.id,
        result: "success",
        origin: origin(ctx),
        metadata: { target: route.scope, agentId: route.consumerRef },
      });
      const connection = await tx.channelConnection.findFirst({
        where: { id: route.connectionId },
      });
      if (connection) rows.push({ route, connection });
    }
    return rows;
  });
  for (const { route, connection } of closed) {
    const config = ChatwootConfig.safeParse(connection.config);
    if (!config.success) continue;
    await setInboxAgentBot(
      accountOf(config.data),
      secretsOf(connection.encryptedSecrets).userToken,
      route.scope,
      null,
      deps,
    ).catch((error: unknown) => {
      appLog.warn("channels.route.bot_not_removed", {
        routeId: route.id,
        code: error instanceof ChannelHttpError ? error.code : "unknown",
      });
    });
  }
  return closed.length;
}
