import "server-only";

import { z } from "zod";

import { QuotaExceededError } from "@/core/entitlements/quotas";
import {
  defineJob,
  definePlatformJob,
  type JobSchedule,
} from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import { ModuleUnavailableError } from "@/core/modules/availability";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { createContact, findContactByPhone } from "@/modules/crm/server";
import { AppError } from "@/shared/errors";

import { noticeUnanswered } from "./notices";

/**
 * Jobs of the Inbox module (IN4b):
 * - `inbox.link-contact` (workspace): makes the CRM contact of a new
 *   conversation with the consumer's name, through the CRM's public
 *   service. It runs as a manager of the workspace (owner or admin), who
 *   may write contacts; a full contact quota or the CRM turned off leave
 *   the conversation without a contact, and the panel says why.
 * - `inbox.unanswered` (platform, every 5 minutes): the notice of
 *   conversations without an answer.
 * The room-opened hook of the core (`../server/room-opened.ts`) asks for
 * the first one and emits the notice of a new conversation.
 */

export const LINK_CONTACT_JOB_KIND = "inbox.link-contact";

/** The name of a contact made from a chat, without one of its own. */
export const FALLBACK_CONTACT_NAME = "Contato do chat";

export const linkContactJob = defineJob<{
  roomId: string;
  phone?: string | undefined;
}>({
  kind: LINK_CONTACT_JOB_KIND,
  description: "Cria o contato do CRM de uma conversa nova do Inbox.",
  payload: z
    .object({
      roomId: z.string().min(2).max(255),
      // A conversation of WhatsApp (IN7a): linked by phone when it exists.
      phone: z
        .string()
        .regex(/^[0-9]{6,20}$/)
        .optional(),
    })
    .strict(),
  maxAttempts: 3,
  retryDelaySeconds: 30,
  async run(tx, ctx, payload) {
    const link = await tx.inboxConversation.findUnique({
      where: { roomId: payload.roomId },
      select: { contactState: true, workspaceId: true },
    });
    if (!link || link.workspaceId !== ctx.workspaceId) {
      throw new SkipJobError("Conversa não encontrada.");
    }
    if (link.contactState !== "pending") return { state: link.contactState };
    const room = await tx.matrixRoom.findUnique({
      where: { roomId: payload.roomId },
      select: { consumerName: true },
    });
    const state = await makeContact(
      tx,
      ctx,
      payload.roomId,
      room?.consumerName?.trim() || FALLBACK_CONTACT_NAME,
      payload.phone ?? null,
    );
    return { state };
  },
});

async function makeContact(
  tx: ContextTransaction,
  ctx: Parameters<typeof createContact>[1],
  roomId: string,
  name: string,
  phone: string | null,
): Promise<"linked" | "quota" | "none"> {
  try {
    const contact =
      (phone ? await findContactByPhone(tx, ctx, phone) : null) ??
      (await createContact(tx, ctx, {
        name: name.slice(0, 160),
        ...(phone ? { phone: `+${phone}` } : {}),
      }));
    await tx.inboxConversation.update({
      where: { roomId },
      data: {
        contactId: contact.id,
        contactState: "linked",
        updatedBy: ctx.userId,
      },
    });
    return "linked";
  } catch (error) {
    // Nothing was written: these are refused before the insert.
    const state =
      error instanceof QuotaExceededError
        ? "quota"
        : error instanceof ModuleUnavailableError ||
            (error instanceof AppError && error.code === "forbidden")
          ? "none"
          : null;
    if (!state) throw error;
    await tx.inboxConversation.update({
      where: { roomId },
      data: { contactState: state, updatedBy: ctx.userId },
    });
    return state;
  }
}

export const unansweredJob = definePlatformJob<{ slot: string }>({
  kind: "inbox.unanswered",
  description:
    "Avisa as conversas do Inbox sem resposta da equipe há 15 minutos.",
  payload: z.object({ slot: z.string().max(32) }).strict(),
  maxAttempts: 2,
  retryDelaySeconds: 60,
  async run(tx) {
    return { ...(await noticeUnanswered(tx)) };
  },
});

/** Every 5 minutes. */
export const unansweredSchedule: JobSchedule = {
  kind: "inbox.unanswered",
  description: "A cada 5 minutos.",
  due(now) {
    const slot = new Date(now);
    slot.setUTCSeconds(0, 0);
    slot.setUTCMinutes(Math.floor(slot.getUTCMinutes() / 5) * 5);
    const key = slot.toISOString().slice(0, 16);
    return { key: `inbox-unanswered:${key}`, payload: { slot: key } };
  },
};

export const inboxJobs = [linkContactJob, unansweredJob] as const;
