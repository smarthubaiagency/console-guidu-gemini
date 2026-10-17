"use server";

import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { matrixConfig } from "@/core/matrix/config";
import {
  changeConversation,
  type ConversationAction,
} from "@/core/matrix/conversation";
import { matrixUnavailable } from "@/core/matrix/session";
import { createSynapseClient } from "@/core/matrix/synapse";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { loadInboxViewer, type InboxViewer } from "./server/access";
import { listConversations } from "./server/conversations";
import { type ConversationPage, INBOX_VIEWS } from "./views";

/**
 * Server actions of the Inbox window (IN4a). Each one resolves the
 * workspace, the module state and the person's level again: the browser's
 * view of who may do what is never trusted.
 */

type Failure = Readonly<{ error: string; requestId?: string }>;

async function inInbox<T>(
  workspaceSlug: string,
  fn: (
    tx: ContextTransaction,
    ctx: RequestContext,
    viewer: InboxViewer,
  ) => Promise<T>,
): Promise<T> {
  const identity = await requireUser();
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  return withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "inbox",
      Permissions.INBOX_VIEW,
    );
    const viewer = await loadInboxViewer(tx, context.userId);
    if (access.kind !== "ok" || viewer.level === null) {
      throw new AppError({
        code: "forbidden",
        safeMessage: "Você não tem permissão para esta ação.",
        messageKey: "errors.permissionDenied",
      });
    }
    return fn(tx, context, viewer);
  });
}

const ListInput = z.object({
  workspaceSlug: z.string().min(1).max(120),
  view: z.enum(INBOX_VIEWS),
  search: z.string().max(80).optional(),
});

export async function listConversationsAction(
  input: z.input<typeof ListInput>,
): Promise<{ page: ConversationPage } | Failure> {
  try {
    const { workspaceSlug, view, search } = ListInput.parse(input);
    return {
      page: await inInbox(workspaceSlug, (tx, _ctx, viewer) =>
        listConversations(tx, {
          view,
          mxid: viewer.mxid,
          search: search ?? null,
        }),
      ),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

const ChangeInput = z.object({
  workspaceSlug: z.string().min(1).max(120),
  roomId: z.string().min(2).max(255),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("take") }),
    z.object({ kind: z.literal("resolve") }),
    z.object({ kind: z.literal("reopen") }),
    z.object({
      kind: z.literal("assign"),
      assignee: z.string().min(4).max(255).nullable(),
    }),
  ]),
});

export async function changeConversationAction(
  input: z.input<typeof ChangeInput>,
): Promise<{ state: { status: string; assignee: string | null } } | Failure> {
  try {
    const parsed = ChangeInput.parse(input);
    const config = matrixConfig();
    if (!config) throw matrixUnavailable();
    const client = createSynapseClient(config);
    const state = await inInbox(parsed.workspaceSlug, (tx, _ctx, viewer) =>
      changeConversation(tx, client, {
        roomId: parsed.roomId,
        action: parsed.action as ConversationAction,
        actor: viewer,
      }),
    );
    return { state };
  } catch (error) {
    return actionFailure(error);
  }
}
