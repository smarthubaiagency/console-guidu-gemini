import "server-only";

import { ModuleUnavailableError } from "@/core/modules/availability";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { getContactCard, listContacts } from "@/modules/crm/server";
import { CrmPermissions } from "@/modules/crm/manifest";
import { AppError } from "@/shared/errors";

import type { InboxViewer } from "./access";

/**
 * The CRM contact of a conversation (IN4b), always through the CRM's
 * public services (ADR 0014, revision of 16/10/2026, item 5): the card is
 * read by who reads the Inbox; searching the CRM and linking the
 * conversation to another contact is for who also reads the CRM (owner,
 * admin, editor; the Attendant has no CRM).
 */

export type ContactState = "pending" | "linked" | "quota" | "none";

export type ConversationContact = Readonly<{
  state: ContactState;
  card: Readonly<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    companyName: string | null;
  }> | null;
  /** Searches the CRM and links another contact. */
  canLink: boolean;
}>;

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Conversa não encontrada.",
    messageKey: "inbox.errors.conversationNotFound",
  });
}

async function readsCrm(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<boolean> {
  return workspaceGrants(await getEffectiveWorkspaceRole(tx, ctx))(
    CrmPermissions.CONTACTS_READ,
  );
}

export async function conversationContact(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  roomId: string,
): Promise<ConversationContact> {
  const room = await tx.matrixRoom.findFirst({
    where: { roomId, workspaceId: ctx.workspaceId },
    select: { roomId: true },
  });
  if (!room) throw notFound();
  const link = await tx.inboxConversation.findUnique({
    where: { roomId },
    select: { contactId: true, contactState: true },
  });
  let card: ConversationContact["card"] = null;
  if (link?.contactId) {
    try {
      card = await getContactCard(tx, ctx, link.contactId);
    } catch (error) {
      // The CRM turned off after the link: the card is not shown.
      if (!(error instanceof ModuleUnavailableError)) throw error;
    }
  }
  const state = (link?.contactState ?? "none") as ContactState;
  return {
    state: link?.contactId && !card ? "none" : state,
    card,
    canLink:
      (viewer.level === "reply" || viewer.manages) && (await readsCrm(tx, ctx)),
  };
}

export async function searchContacts(
  tx: ContextTransaction,
  ctx: RequestContext,
  query: string,
): Promise<{ id: string; name: string; detail: string | null }[]> {
  const page = await listContacts(tx, ctx, {
    search: query.trim().slice(0, 100) || undefined,
    limit: 10,
  });
  return page.items.map((contact) => ({
    id: contact.id,
    name: contact.name,
    detail: contact.phone ?? contact.email ?? contact.companyName,
  }));
}

/** Links the conversation to another contact of the CRM. */
export async function linkContact(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  input: Readonly<{ roomId: string; contactId: string }>,
): Promise<void> {
  if (
    !(viewer.level === "reply" || viewer.manages) ||
    !(await readsCrm(tx, ctx))
  ) {
    throw new AppError({
      code: "forbidden",
      safeMessage: "Você não tem permissão para esta ação.",
      messageKey: "errors.permissionDenied",
    });
  }
  const room = await tx.matrixRoom.findFirst({
    where: { roomId: input.roomId, workspaceId: ctx.workspaceId },
    select: { roomId: true, organizationId: true },
  });
  const card = await getContactCard(tx, ctx, input.contactId);
  if (!room || !card) throw notFound();
  await tx.$executeRaw`
    insert into public.inbox_conversations
      (room_id, organization_id, workspace_id, contact_id, contact_state, updated_by)
    values (${input.roomId}, ${room.organizationId}::uuid, ${ctx.workspaceId}::uuid,
            ${card.id}::uuid, 'linked', ${ctx.userId}::uuid)
    on conflict (room_id) do update
      set contact_id = excluded.contact_id, contact_state = 'linked',
          updated_by = excluded.updated_by
  `;
}
