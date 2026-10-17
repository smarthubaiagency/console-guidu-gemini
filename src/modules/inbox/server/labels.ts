import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type { InboxViewer } from "./access";

/**
 * Labels of the Inbox (IN4b): a catalog per workspace, kept by who manages
 * the Inbox (owner and admin), and labels on conversations, put and taken
 * by who answers. Internal: never written in the room (ADR 0023, rule 6).
 * The database checks the same (policies of `inbox_labels` and
 * `inbox_room_labels`).
 */

export const LABEL_COLORS = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export type InboxLabel = Readonly<{
  id: string;
  name: string;
  color: LabelColor;
}>;

/** Labels per workspace: enough for a team, small enough for a menu. */
export const MAX_LABELS = 50;

export const LabelInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(LABEL_COLORS),
});

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "errors.permissionDenied",
  });
}

function duplicated(): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: "Já existe uma etiqueta com esse nome.",
    messageKey: "inbox.errors.labelExists",
  });
}

function asLabel(row: { id: string; name: string; color: string }): InboxLabel {
  const color = (LABEL_COLORS as readonly string[]).includes(row.color)
    ? (row.color as LabelColor)
    : "neutral";
  return { id: row.id, name: row.name, color };
}

export async function listLabels(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<InboxLabel[]> {
  const rows = await tx.inboxLabel.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
  return rows.map(asLabel);
}

async function uniqueName<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw duplicated();
    }
    throw error;
  }
}

export async function createLabel(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  input: unknown,
): Promise<InboxLabel> {
  if (!viewer.manages) throw denied();
  const data = LabelInput.parse(input);
  const count = await tx.inboxLabel.count({
    where: { workspaceId: ctx.workspaceId },
  });
  if (count >= MAX_LABELS) {
    throw new AppError({
      code: "conflict",
      safeMessage: `O Inbox aceita até ${MAX_LABELS} etiquetas.`,
      messageKey: "inbox.errors.tooManyLabels",
      messageValues: { max: MAX_LABELS },
    });
  }
  const row = await uniqueName(() =>
    tx.inboxLabel.create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        name: data.name,
        color: data.color,
        createdBy: ctx.userId,
      },
      select: { id: true, name: true, color: true },
    }),
  );
  return asLabel(row);
}

export async function updateLabel(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  labelId: string,
  input: unknown,
): Promise<InboxLabel> {
  if (!viewer.manages) throw denied();
  const data = LabelInput.parse(input);
  const updated = await uniqueName(() =>
    tx.inboxLabel.updateMany({
      where: { id: labelId, workspaceId: ctx.workspaceId },
      data: { name: data.name, color: data.color },
    }),
  );
  if (updated.count === 0) throw labelNotFound();
  return { id: labelId, name: data.name, color: data.color };
}

export async function deleteLabel(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  labelId: string,
): Promise<void> {
  if (!viewer.manages) throw denied();
  const deleted = await tx.inboxLabel.deleteMany({
    where: { id: labelId, workspaceId: ctx.workspaceId },
  });
  if (deleted.count === 0) throw labelNotFound();
}

function labelNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Etiqueta não encontrada.",
    messageKey: "inbox.errors.labelNotFound",
  });
}

/** Puts a label on a conversation, or takes it off (who answers). */
export async function setRoomLabel(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  input: Readonly<{ roomId: string; labelId: string; on: boolean }>,
): Promise<void> {
  if (viewer.level !== "reply") throw denied();
  const room = await tx.matrixRoom.findFirst({
    where: { roomId: input.roomId, workspaceId: ctx.workspaceId },
    select: { roomId: true },
  });
  const label = await tx.inboxLabel.findFirst({
    where: { id: input.labelId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!room || !label) throw labelNotFound();
  if (!input.on) {
    await tx.inboxRoomLabel.deleteMany({
      where: { roomId: input.roomId, labelId: input.labelId },
    });
    return;
  }
  await tx.$executeRaw`
    insert into public.inbox_room_labels
      (room_id, label_id, organization_id, workspace_id, created_by)
    values (${input.roomId}, ${input.labelId}::uuid, ${ctx.organizationId}::uuid,
            ${ctx.workspaceId}::uuid, ${ctx.userId}::uuid)
    on conflict (room_id, label_id) do nothing
  `;
}

/** The labels of some conversations, by room. */
export async function labelsOfRooms(
  tx: ContextTransaction,
  roomIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (roomIds.length === 0) return out;
  const rows = await tx.inboxRoomLabel.findMany({
    where: { roomId: { in: [...roomIds] } },
    select: { roomId: true, labelId: true },
  });
  for (const row of rows) {
    out.set(row.roomId, [...(out.get(row.roomId) ?? []), row.labelId]);
  }
  return out;
}
