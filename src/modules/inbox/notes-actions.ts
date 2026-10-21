"use server";

import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
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
  createNote,
  deleteNote,
  type InboxNoteView,
  listNotes,
  NOTE_MAX,
  updateNote,
} from "./server/notes";

/**
 * Server actions of the private notes (IN5a). Each one resolves the
 * workspace, the module and the person's level again; the service checks
 * who may write, and the database checks the same. Nothing here talks to
 * Synapse: a note never goes to the room.
 */

type Failure = Readonly<{ error: string; requestId?: string }>;

const Slug = z.string().min(1).max(120);
const RoomId = z.string().regex(/^![^\s]{1,254}$/);
const Body = z.string().max(NOTE_MAX * 2);

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

const ListInput = z.object({ workspaceSlug: Slug, roomId: RoomId });

export async function listNotesAction(
  input: z.input<typeof ListInput>,
): Promise<{ notes: InboxNoteView[] } | Failure> {
  try {
    const { workspaceSlug, roomId } = ListInput.parse(input);
    const notes = await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      listNotes(tx, ctx, viewer, roomId),
    );
    return { notes };
  } catch (error) {
    return actionFailure(error);
  }
}

const CreateInput = z.object({
  workspaceSlug: Slug,
  roomId: RoomId,
  body: Body,
});

export async function createNoteAction(
  input: z.input<typeof CreateInput>,
): Promise<{ note: InboxNoteView } | Failure> {
  try {
    const { workspaceSlug, ...rest } = CreateInput.parse(input);
    const note = await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      createNote(tx, ctx, viewer, rest),
    );
    return { note };
  } catch (error) {
    return actionFailure(error);
  }
}

const UpdateInput = z.object({
  workspaceSlug: Slug,
  noteId: z.string().uuid(),
  body: Body,
});

export async function updateNoteAction(
  input: z.input<typeof UpdateInput>,
): Promise<{ note: InboxNoteView } | Failure> {
  try {
    const { workspaceSlug, ...rest } = UpdateInput.parse(input);
    const note = await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      updateNote(tx, ctx, viewer, rest),
    );
    return { note };
  } catch (error) {
    return actionFailure(error);
  }
}

const DeleteInput = z.object({
  workspaceSlug: Slug,
  noteId: z.string().uuid(),
});

export async function deleteNoteAction(
  input: z.input<typeof DeleteInput>,
): Promise<{ ok: true } | Failure> {
  try {
    const { workspaceSlug, noteId } = DeleteInput.parse(input);
    await inInbox(workspaceSlug, (tx, ctx, viewer) =>
      deleteNote(tx, ctx, viewer, noteId),
    );
    return { ok: true };
  } catch (error) {
    return actionFailure(error);
  }
}
