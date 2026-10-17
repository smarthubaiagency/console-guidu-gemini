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
import {
  conversationContact,
  type ConversationContact,
  linkContact,
  searchContacts,
} from "./server/contacts";
import { listConversations } from "./server/conversations";
import {
  createLabel,
  deleteLabel,
  type InboxLabel,
  setRoomLabel,
  updateLabel,
} from "./server/labels";
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
  labelId: z.string().uuid().optional(),
});

export async function listConversationsAction(
  input: z.input<typeof ListInput>,
): Promise<{ page: ConversationPage } | Failure> {
  try {
    const { workspaceSlug, view, search, labelId } = ListInput.parse(input);
    return {
      page: await inInbox(workspaceSlug, (tx, ctx, viewer) =>
        listConversations(tx, ctx, {
          view,
          mxid: viewer.mxid,
          search: search ?? null,
          labelId: labelId ?? null,
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

// ---------------------------------------------------------------------------
// Labels (IN4b)
// ---------------------------------------------------------------------------

const Slug = z.string().min(1).max(120);
const RoomId = z.string().min(2).max(255);

const LabelSaveInput = z.object({
  workspaceSlug: Slug,
  labelId: z.string().uuid().optional(),
  name: z.string(),
  color: z.string(),
});

export async function saveLabelAction(
  input: z.input<typeof LabelSaveInput>,
): Promise<{ label: InboxLabel } | Failure> {
  try {
    const { workspaceSlug, labelId, name, color } = LabelSaveInput.parse(input);
    const label = await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      labelId
        ? updateLabel(tx, ctx, viewer, labelId, { name, color })
        : createLabel(tx, ctx, viewer, { name, color }),
    );
    return { label };
  } catch (error) {
    return actionFailure(error);
  }
}

const LabelDeleteInput = z.object({
  workspaceSlug: Slug,
  labelId: z.string().uuid(),
});

export async function deleteLabelAction(
  input: z.input<typeof LabelDeleteInput>,
): Promise<{ ok: true } | Failure> {
  try {
    const { workspaceSlug, labelId } = LabelDeleteInput.parse(input);
    await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      deleteLabel(tx, ctx, viewer, labelId),
    );
    return { ok: true };
  } catch (error) {
    return actionFailure(error);
  }
}

const RoomLabelInput = z.object({
  workspaceSlug: Slug,
  roomId: RoomId,
  labelId: z.string().uuid(),
  on: z.boolean(),
});

export async function setRoomLabelAction(
  input: z.input<typeof RoomLabelInput>,
): Promise<{ ok: true } | Failure> {
  try {
    const { workspaceSlug, ...rest } = RoomLabelInput.parse(input);
    await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      setRoomLabel(tx, ctx, viewer, rest),
    );
    return { ok: true };
  } catch (error) {
    return actionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// The CRM contact of a conversation (IN4b)
// ---------------------------------------------------------------------------

const RoomInput = z.object({ workspaceSlug: Slug, roomId: RoomId });

export async function conversationContactAction(
  input: z.input<typeof RoomInput>,
): Promise<{ contact: ConversationContact } | Failure> {
  try {
    const { workspaceSlug, roomId } = RoomInput.parse(input);
    const contact = await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      conversationContact(tx, ctx, viewer, roomId),
    );
    return { contact };
  } catch (error) {
    return actionFailure(error);
  }
}

const SearchInput = z.object({
  workspaceSlug: Slug,
  query: z.string().max(100),
});

export async function searchContactsAction(
  input: z.input<typeof SearchInput>,
): Promise<
  { contacts: { id: string; name: string; detail: string | null }[] } | Failure
> {
  try {
    const { workspaceSlug, query } = SearchInput.parse(input);
    const contacts = await inInbox(workspaceSlug, (tx, ctx) =>
      searchContacts(tx, ctx, query),
    );
    return { contacts };
  } catch (error) {
    return actionFailure(error);
  }
}

const LinkInput = z.object({
  workspaceSlug: Slug,
  roomId: RoomId,
  contactId: z.string().uuid(),
});

export async function linkContactAction(
  input: z.input<typeof LinkInput>,
): Promise<{ ok: true } | Failure> {
  try {
    const { workspaceSlug, ...rest } = LinkInput.parse(input);
    await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      linkContact(tx, ctx, viewer, rest),
    );
    return { ok: true };
  } catch (error) {
    return actionFailure(error);
  }
}
