import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import type { InboxViewer } from "./access";

/**
 * Private notes of a conversation (IN5a, docs/modules/inbox/plano-tr2-in5a.md):
 * only the team sees them. They live in `inbox_notes`, by room, and never
 * go to the Matrix room, where the contact is a member. Everyone with a
 * level reads; who answers (`reply`) writes; the author edits and deletes
 * the own note (softly: the row stays, without the text). Each change is
 * audited without the text. The database checks the same (policies of
 * `inbox_notes`). The functions take the viewer of the caller, so an API
 * route can call them as the server actions do.
 */

export const NOTE_MAX = 4000;

export const NoteBody = z.string().trim().min(1).max(NOTE_MAX);

export type InboxNoteView = Readonly<{
  id: string;
  roomId: string;
  authorId: string | null;
  /** Null when the author left the workspace. */
  authorName: string | null;
  /** Empty when deleted. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  mine: boolean;
}>;

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "errors.permissionDenied",
  });
}

function noteNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Nota não encontrada.",
    messageKey: "inbox.notes.errors.notFound",
  });
}

function conversationNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Conversa não encontrada.",
    messageKey: "inbox.errors.conversationNotFound",
  });
}

const SELECT = {
  id: true,
  roomId: true,
  userId: true,
  body: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
} as const;

type NoteRow = Readonly<{
  id: string;
  roomId: string;
  userId: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}>;

function asView(
  row: NoteRow,
  ctx: RequestContext,
  names: ReadonlyMap<string, string | null>,
): InboxNoteView {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    roomId: row.roomId,
    authorId: row.userId,
    authorName: row.userId ? (names.get(row.userId) ?? null) : null,
    body: deleted ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deleted,
    mine: row.userId !== null && row.userId === ctx.userId,
  };
}

/** Names of the authors of the notes of the context workspace. */
async function authorNames(
  tx: ContextTransaction,
): Promise<Map<string, string | null>> {
  const rows = await tx.$queryRaw<
    { user_id: string; full_name: string | null }[]
  >`select user_id, full_name from private.inbox_note_authors()`;
  return new Map(rows.map((row) => [row.user_id, row.full_name]));
}

/** The notes of a conversation, oldest first (the order of the timeline). */
export async function listNotes(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  roomId: string,
): Promise<InboxNoteView[]> {
  if (viewer.level === null) throw denied();
  const rows = await tx.inboxNote.findMany({
    where: { roomId, workspaceId: ctx.workspaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SELECT,
  });
  if (rows.length === 0) return [];
  const names = await authorNames(tx);
  return rows.map((row) => asView(row, ctx, names));
}

export async function createNote(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  input: Readonly<{ roomId: string; body: string }>,
): Promise<InboxNoteView> {
  if (viewer.level !== "reply") throw denied();
  const body = NoteBody.parse(input.body);
  const room = await tx.matrixRoom.findFirst({
    where: { roomId: input.roomId, workspaceId: ctx.workspaceId },
    select: { roomId: true },
  });
  if (!room) throw conversationNotFound();
  const row = await tx.inboxNote.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      roomId: input.roomId,
      userId: ctx.userId,
      body,
    },
    select: SELECT,
  });
  await audit(tx, ctx, "inbox.note.create", row);
  return asView(row, ctx, await authorNames(tx));
}

/** A live note of the author, in the context workspace. */
async function ownNote(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  noteId: string,
): Promise<NoteRow> {
  if (viewer.level !== "reply") throw denied();
  const note = await tx.inboxNote.findFirst({
    where: { id: noteId, workspaceId: ctx.workspaceId },
    select: SELECT,
  });
  if (!note || note.deletedAt) throw noteNotFound();
  if (note.userId !== ctx.userId) throw denied();
  return note;
}

export async function updateNote(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  input: Readonly<{ noteId: string; body: string }>,
): Promise<InboxNoteView> {
  const body = NoteBody.parse(input.body);
  const note = await ownNote(tx, ctx, viewer, input.noteId);
  if (note.body === body) return asView(note, ctx, await authorNames(tx));
  const row = await tx.inboxNote.update({
    where: { id: note.id },
    data: { body, editedAt: new Date() },
    select: SELECT,
  });
  await audit(tx, ctx, "inbox.note.update", row);
  return asView(row, ctx, await authorNames(tx));
}

/** Deletes softly: the row stays, without its text ("Nota apagada"). */
export async function deleteNote(
  tx: ContextTransaction,
  ctx: RequestContext,
  viewer: InboxViewer,
  noteId: string,
): Promise<void> {
  const note = await ownNote(tx, ctx, viewer, noteId);
  await tx.inboxNote.update({
    where: { id: note.id },
    data: { body: "", deletedAt: new Date() },
    select: { id: true },
  });
  await audit(tx, ctx, "inbox.note.delete", note);
}

/** Who, when (the event) and which note; never the text. */
async function audit(
  tx: ContextTransaction,
  ctx: RequestContext,
  action: "inbox.note.create" | "inbox.note.update" | "inbox.note.delete",
  note: Readonly<{ id: string; roomId: string }>,
): Promise<void> {
  await recordAudit(tx, ctx, {
    action,
    resourceType: "inbox_note",
    resourceId: note.id,
    result: "success",
    origin: "app",
    metadata: { target: note.roomId },
  });
}
