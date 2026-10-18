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
  type ChannelConnectionDto,
  ChannelInputError,
  loadRow,
  notFound,
  origin,
  toDto,
} from "./connections";
import { ChannelHttpError } from "./http";
import {
  checkMetaNumber,
  exchangeMetaCode,
  metaApp,
  MetaConfig,
  type MetaDeps,
  MetaSecrets,
  registerMetaNumber,
  subscribeMetaApp,
} from "./meta";
import { newWebhookToken } from "./webhook";

/**
 * Numbers of the WhatsApp Cloud API of Meta (IN7a, plano-in7.md §1):
 * linked by hand (the number, the business account and a system user's
 * token) or by the Embedded Signup (the code Meta gives the screen,
 * exchanged with the app secret). Either way the core checks the number
 * with Meta, puts the GUIDU app on the business account (so its webhooks
 * come) and keeps the token encrypted. `channels.manage` does it all,
 * with audit and never the token's value.
 *
 * Who answers a number is its route: the GUIDS named by the route
 * (`consumer_module = 'inbox'`), in the room of each person (IN7a: "só o
 * GUIDS"; the team joins in the IN7b).
 */

const NUMBER_ID = z
  .string()
  .trim()
  .regex(/^[0-9]{5,30}$/, { error: "Use só os números do identificador." });

const name = z
  .string()
  .trim()
  .min(1, { error: "Informe um nome." })
  .max(80, { error: "Use até 80 caracteres." });

export const MetaManualInput = z.strictObject({
  name,
  phoneNumberId: NUMBER_ID,
  wabaId: NUMBER_ID,
  accessToken: z
    .string()
    .trim()
    .min(20, { error: "Informe o token de acesso." })
    .max(1000),
});

export const MetaEmbeddedInput = z.strictObject({
  name,
  code: z.string().trim().min(8).max(2000),
  phoneNumberId: NUMBER_ID,
  wabaId: NUMBER_ID,
  /** The two-step PIN, when the number is new on the Cloud API. */
  pin: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, { error: "O PIN tem 6 dígitos." })
    .optional(),
});

export class MetaProviderError extends AppError {
  constructor(readonly providerCode: string) {
    super({
      code: "provider_error",
      safeMessage: "A Meta não aceitou a conexão do número.",
      messageKey: `channels.errors.provider.${providerCode}`,
    });
  }
}

function numberTaken(): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: "Este número já está ligado ao GUIDU.",
    messageKey: "channels.errors.numberTaken",
  });
}

function fieldErrors(error: z.ZodError): ChannelInputError {
  return new ChannelInputError(
    Object.fromEntries(
      error.issues.map((issue) => [
        String(issue.path[0] ?? "form"),
        issue.message,
      ]),
    ),
  );
}

async function providerStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof ChannelHttpError) {
      appLog.warn("channels.meta.connection_failed", {
        code: error.code,
        status: error.status,
      });
      throw new MetaProviderError(error.code);
    }
    throw error;
  }
}

async function createRow(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: Readonly<{
    name: string;
    phoneNumberId: string;
    wabaId: string;
    accessToken: string;
    linkedVia: MetaConfig["linked_via"];
  }>,
  deps: MetaDeps,
): Promise<ChannelConnectionDto> {
  const number = await providerStep(() =>
    checkMetaNumber(input.phoneNumberId, input.accessToken, deps),
  );
  await providerStep(() =>
    subscribeMetaApp(input.wabaId, input.accessToken, deps),
  );
  const config: MetaConfig = {
    phone_number_id: input.phoneNumberId,
    waba_id: input.wabaId,
    display_phone_number: number.displayPhoneNumber,
    verified_name: number.verifiedName,
    linked_via: input.linkedVia,
  };
  const secrets: MetaSecrets = { accessToken: input.accessToken };
  const { encryptedPayload } = encryptSecret(JSON.stringify(secrets));
  try {
    return await withContext(prisma, ctx, async (tx) => {
      await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
      const created = await tx.channelConnection.create({
        data: {
          id: randomUUID(),
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          kind: "meta_whatsapp",
          name: input.name,
          config,
          encryptedSecrets: encryptedPayload,
          maskedSecret: maskSecret(input.accessToken),
          // Unused for Meta (one webhook of the app), kept by the schema.
          webhookTokenHash: newWebhookToken().hash,
          healthStatus: "ok",
          healthCheckedAt: new Date(),
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
          kind: "meta_whatsapp",
          name: created.name,
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          linkedVia: input.linkedVia,
        },
      });
      return toDto(created, 0);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw numberTaken();
    }
    throw error;
  }
}

/** A number linked by hand, with a system user's token. */
export async function createMetaConnection(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: unknown,
  deps: MetaDeps = {},
): Promise<ChannelConnectionDto> {
  await withContext(prisma, ctx, (tx) =>
    requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE),
  );
  const parsed = MetaManualInput.safeParse(input);
  if (!parsed.success) throw fieldErrors(parsed.error);
  return createRow(prisma, ctx, { ...parsed.data, linkedVia: "manual" }, deps);
}

/**
 * A number linked by the Embedded Signup: the code becomes the business's
 * token, and a number new on the Cloud API is registered with its PIN.
 */
export async function completeMetaEmbeddedSignup(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: unknown,
  deps: MetaDeps = {},
): Promise<ChannelConnectionDto> {
  await withContext(prisma, ctx, (tx) =>
    requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE),
  );
  const parsed = MetaEmbeddedInput.safeParse(input);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const app = metaApp();
  if (!app.appId || !app.appSecret) {
    throw new AppError({
      code: "unavailable",
      safeMessage: "O app da Meta não está configurado.",
      messageKey: "channels.errors.metaAppMissing",
    });
  }
  const accessToken = await providerStep(() =>
    exchangeMetaCode(parsed.data.code, app, deps),
  );
  if (parsed.data.pin) {
    const pin = parsed.data.pin;
    await providerStep(() =>
      registerMetaNumber(parsed.data.phoneNumberId, accessToken, pin, deps),
    );
  }
  return createRow(
    prisma,
    ctx,
    {
      name: parsed.data.name,
      phoneNumberId: parsed.data.phoneNumberId,
      wabaId: parsed.data.wabaId,
      accessToken,
      linkedVia: "embedded",
    },
    deps,
  );
}

type Row = Parameters<typeof toDto>[0];

/** The health check of a number: it is still there and the token works. */
export async function checkMetaConnection(
  prisma: PrismaClient,
  ctx: RequestContext,
  row: Row,
  deps: MetaDeps = {},
): Promise<ChannelConnectionDto> {
  const config = MetaConfig.parse(row.config);
  const secrets = MetaSecrets.parse(
    JSON.parse(decryptSecret(row.encryptedSecrets)),
  );
  let code: string | null = null;
  let number: Awaited<ReturnType<typeof checkMetaNumber>> | null = null;
  try {
    number = await checkMetaNumber(
      config.phone_number_id,
      secrets.accessToken,
      deps,
    );
  } catch (error) {
    if (!(error instanceof ChannelHttpError)) throw error;
    code = error.code;
  }
  return withContext(prisma, ctx, async (tx) => {
    await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
    const updated = await tx.channelConnection.update({
      where: { id: row.id },
      data: {
        healthStatus: number ? "ok" : "failed",
        healthError: code,
        healthCheckedAt: new Date(),
        updatedBy: ctx.userId,
        ...(number
          ? {
              config: {
                ...config,
                display_phone_number: number.displayPhoneNumber,
                verified_name: number.verifiedName,
              },
            }
          : {}),
      },
    });
    await recordAudit(tx, ctx, {
      action: "channels.connection.check",
      resourceType: "channel_connection",
      resourceId: row.id,
      result: number ? "success" : "error",
      origin: origin(ctx),
      metadata: { kind: row.kind, reason: code ?? "" },
    });
    const unrouted = await tx.channelInboundEvent.count({
      where: { connectionId: row.id, status: "no_route" },
    });
    return toDto(updated, unrouted);
  });
}

export const MetaRouteInput = z.strictObject({
  connectionId: z.uuid(),
  /** The GUIDS that answers the number; null: nobody (events are kept). */
  agentId: z.uuid().nullable(),
});

export type MetaRouteDto = Readonly<{
  connectionId: string;
  agentId: string | null;
}>;

/** Who answers each number of Meta of the workspace. */
export async function listMetaRoutes(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<MetaRouteDto[]> {
  await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_READ);
  const connections = await tx.channelConnection.findMany({
    where: { workspaceId: ctx.workspaceId, kind: "meta_whatsapp" },
    select: { id: true },
  });
  const routes = await tx.channelRoute.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: "active",
      consumerModule: "inbox",
      connectionId: { in: connections.map((c) => c.id) },
    },
    select: { connectionId: true, consumerRef: true },
  });
  return connections.map((c) => ({
    connectionId: c.id,
    agentId: routes.find((r) => r.connectionId === c.id)?.consumerRef ?? null,
  }));
}

/**
 * Names the GUIDS that answers a number (or nobody): the active route of
 * the number is closed and a new one opened, in one transaction. The
 * conversations stay in their rooms (plano-in7.md §0): only who answers
 * changes. The person who does it is who the turns run as.
 */
export async function setMetaRoute(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<MetaRouteDto> {
  await requireWorkspacePermission(tx, ctx, Permissions.CHANNELS_MANAGE);
  const parsed = MetaRouteInput.safeParse(input);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const row = await loadRow(tx, ctx, parsed.data.connectionId);
  if (row.kind !== "meta_whatsapp") throw notFound();
  const config = MetaConfig.parse(row.config);
  const agentId = parsed.data.agentId;
  if (agentId) {
    const agent = await tx.aiAgent.findFirst({
      where: { id: agentId, workspaceId: ctx.workspaceId, kind: "guid" },
      select: { id: true },
    });
    if (!agent) throw notFound();
  }
  const current = await tx.channelRoute.findFirst({
    where: {
      connectionId: row.id,
      scope: config.phone_number_id,
      status: "active",
    },
    select: { id: true, consumerModule: true, consumerRef: true },
  });
  if (current?.consumerModule === "inbox" && current.consumerRef === agentId) {
    return { connectionId: row.id, agentId };
  }
  if (current) {
    await tx.channelRoute.update({
      where: { id: current.id },
      data: { status: "closed", updatedBy: ctx.userId },
    });
    await recordAudit(tx, ctx, {
      action: "channels.route.close",
      resourceType: "channel_route",
      resourceId: current.id,
      result: "success",
      origin: origin(ctx),
      metadata: { connectionId: row.id, scope: config.phone_number_id },
    });
  }
  if (agentId) {
    const created = await tx.channelRoute.create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        connectionId: row.id,
        scope: config.phone_number_id,
        consumerModule: "inbox",
        consumerRef: agentId,
        createdBy: ctx.userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: "channels.route.open",
      resourceType: "channel_route",
      resourceId: created.id,
      result: "success",
      origin: origin(ctx),
      metadata: {
        connectionId: row.id,
        scope: config.phone_number_id,
        consumerModule: "inbox",
        agentId,
      },
    });
  }
  return { connectionId: row.id, agentId };
}
