import "server-only";

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { type MediaKind, missingMedia, voiceOptions } from "@/core/ai/media";
import {
  type ChannelDeps,
  closeChannelRoutes,
  listChannelInboxes,
  openChannelRoute,
} from "@/core/channels/connections";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  requireWorkspacePermission,
} from "@/core/permissions/guard";
import { hasWorkspaceRolePermission } from "@/core/permissions/matrix";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { AI_AGENTS_MODULE } from "../channel-consumer";
import { getGuid } from "./guid-config";

/**
 * Channels of a GUIDS (A5b, aba Canais da gaveta): the inboxes of the
 * workspace's connections, which of them this agent answers, and turning
 * an inbox on or off for it. The route belongs to the core; this module
 * only asks for it with its own permission (ai_agents.manage) on top of
 * the core's (channels.manage). Only a GUIDS turned on, with its current
 * configuration tested, takes an inbox.
 */

export type GuidInboxDto = Readonly<{
  connectionId: string;
  connectionName: string;
  inboxId: string;
  inboxName: string;
  channelType: string | null;
  /** This agent answers it, another agent (or module) does, or nobody. */
  state: "mine" | "other" | "free";
  /** The route, when this agent has it. */
  routeId: string | null;
  /** The name of the other GUIDS that answers it. */
  otherAgent: string | null;
}>;

export type GuidChannelsDto = Readonly<{
  inboxes: readonly GuidInboxDto[];
  /** Turning inboxes on and off is open to this person. */
  canManage: boolean;
  /**
   * What the agent's key does not read of what contacts send (A5c); null
   * while the agent has no key.
   */
  missingMedia: readonly MediaKind[] | null;
}>;

/**
 * The inboxes, or null when the person does not see the channels
 * (`channels.read`): the tab then explains where they are set.
 */
export async function listGuidChannels(
  tx: ContextTransaction,
  ctx: RequestContext,
  agentId: string,
): Promise<GuidChannelsDto | null> {
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  if (!role || !hasWorkspaceRolePermission(role, Permissions.CHANNELS_READ)) {
    return null;
  }
  const inboxes = await listChannelInboxes(tx, ctx);
  const agent = await tx.aiAgent.findFirst({
    where: { id: agentId, workspaceId: ctx.workspaceId, kind: "guid" },
    select: { config: true },
  });
  // The text key reads; the voice key, when chosen, hears (A5d).
  const model = (
    agent?.config as {
      model?: {
        credential_id?: string | null;
        audio_credential_id?: string | null;
      };
    } | null
  )?.model;
  const providerOf = async (id: string | null | undefined) =>
    id
      ? ((
          await tx.credential.findFirst({
            where: { id, workspaceId: ctx.workspaceId },
            select: { provider: true },
          })
        )?.provider ?? null)
      : null;
  const textProvider = await providerOf(model?.credential_id);
  const voiceProvider = await providerOf(model?.audio_credential_id);
  const missing = textProvider
    ? missingMedia(textProvider).filter(
        (kind) =>
          !(kind === "audio" && voiceProvider && voiceOptions(voiceProvider)),
      )
    : null;
  const others = inboxes
    .map((inbox) => inbox.route)
    .filter(
      (route) =>
        route?.consumerModule === AI_AGENTS_MODULE &&
        route.consumerRef !== agentId,
    )
    .map((route) => route!.consumerRef);
  const names = new Map(
    (
      await tx.aiAgent.findMany({
        where: { id: { in: others }, workspaceId: ctx.workspaceId },
        select: { id: true, config: true },
      })
    ).map((agent) => [
      agent.id,
      ((agent.config as { overview?: { agent_name?: string } } | null)?.overview
        ?.agent_name ?? null) as string | null,
    ]),
  );
  return {
    missingMedia: missing,
    canManage:
      hasWorkspaceRolePermission(role, Permissions.AI_AGENTS_MANAGE) &&
      hasWorkspaceRolePermission(role, Permissions.CHANNELS_MANAGE),
    inboxes: inboxes.map((inbox) => {
      const route = inbox.route;
      const mine =
        route?.consumerModule === AI_AGENTS_MODULE &&
        route.consumerRef === agentId;
      return {
        connectionId: inbox.connectionId,
        connectionName: inbox.connectionName,
        inboxId: inbox.inboxId,
        inboxName: inbox.inboxName,
        channelType: inbox.channelType,
        state: mine ? "mine" : route ? "other" : "free",
        routeId: mine ? route.id : null,
        otherAgent:
          route && !mine && route.consumerModule === AI_AGENTS_MODULE
            ? (names.get(route.consumerRef) ?? null)
            : null,
      };
    }),
  };
}

export const BindInboxInput = z.strictObject({
  agentId: z.uuid(),
  connectionId: z.uuid(),
  inboxId: z.string().trim().min(1).max(200),
});

export const UnbindInboxInput = z.strictObject({
  agentId: z.uuid(),
  routeId: z.uuid(),
});

function invalid(): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: "Dados inválidos.",
  });
}

/** This GUIDS starts answering an inbox. */
export async function bindGuidInbox(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: unknown,
  deps: ChannelDeps = {},
): Promise<{ id: string }> {
  const parsed = BindInboxInput.safeParse(input);
  if (!parsed.success) throw invalid();
  const { agentId, connectionId, inboxId } = parsed.data;
  await withContext(prisma, ctx, async (tx) => {
    await assertModuleOperational(tx, ctx, AI_AGENTS_MODULE, "write");
    await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE);
    const guid = await getGuid(tx, ctx, agentId);
    if (guid.status !== "active" || !guid.testedCurrent) {
      throw new AppError({
        code: "conflict",
        safeMessage:
          "Teste e ative o agente nesta configuração antes de ligá-lo a uma inbox.",
        messageKey: "aiAgents.guids.channels.needsActive",
      });
    }
  });
  return openChannelRoute(
    prisma,
    ctx,
    {
      connectionId,
      scope: inboxId,
      consumerModule: AI_AGENTS_MODULE,
      consumerRef: agentId,
    },
    deps,
  );
}

/** This GUIDS stops answering an inbox. */
export async function unbindGuidInbox(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: unknown,
  deps: ChannelDeps = {},
): Promise<void> {
  const parsed = UnbindInboxInput.safeParse(input);
  if (!parsed.success) throw invalid();
  await withContext(prisma, ctx, (tx) =>
    requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_MANAGE),
  );
  const closed = await closeChannelRoutes(
    prisma,
    ctx,
    {
      consumerModule: AI_AGENTS_MODULE,
      consumerRef: parsed.data.agentId,
      routeId: parsed.data.routeId,
    },
    deps,
  );
  if (closed === 0) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Esta inbox não está com este agente.",
      messageKey: "apiErrors.notFound",
    });
  }
}

/** Every inbox of a GUIDS that is about to be deleted. */
export async function releaseGuidInboxes(
  prisma: PrismaClient,
  ctx: RequestContext,
  agentId: string,
  deps: ChannelDeps = {},
): Promise<number> {
  return closeChannelRoutes(
    prisma,
    ctx,
    { consumerModule: AI_AGENTS_MODULE, consumerRef: agentId },
    deps,
  );
}
