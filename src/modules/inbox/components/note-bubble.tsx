"use client";

import { useRef, useState } from "react";
import { Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { deleteNoteAction, updateNoteAction } from "../notes-actions";
import type { InboxNoteView } from "../server/notes";

/**
 * A private note in the timeline of the conversation (IN5a): an amber
 * bubble with a lock, the author and "Nota privada", on the team's side.
 * The author (still answering) edits it in place and deletes it from the
 * note's menu; a deleted note shows "Nota apagada", an edited one
 * "editada". The contact never sees it: it is not in the room.
 */
export function NoteBubble({
  workspaceSlug,
  note,
  canWrite,
  highlighted,
  onChanged,
}: Readonly<{
  workspaceSlug: string;
  note: InboxNoteView;
  /** The viewer answers (level `reply`): the author may change the note. */
  canWrite: boolean;
  highlighted: boolean;
  onChanged: () => Promise<void>;
}>) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const { showStatus, confirmStatus } = useStatus();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [busy, setBusy] = useState(false);
  // Editar opens the field: the menu must not take the focus back.
  const keepFocus = useRef(false);
  const author = note.mine
    ? t("you")
    : (note.authorName ?? t("notes.unknownAuthor"));
  const changeable = canWrite && note.mine && !note.deleted;

  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    if (body === note.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const result = await updateNoteAction({
        workspaceSlug,
        noteId: note.id,
        body,
      });
      if ("error" in result) {
        showStatus({ type: "down", title: result.error });
        return;
      }
      setEditing(false);
      showStatus({ type: "up", title: t("notes.updated") });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = await confirmStatus({
      title: t("notes.confirmDelete"),
      confirmLabel: t("notes.delete"),
      cancelLabel: t("notes.cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await deleteNoteAction({ workspaceSlug, noteId: note.id });
      if ("error" in result) {
        showStatus({ type: "down", title: result.error });
        return;
      }
      showStatus({ type: "up", title: t("notes.deleted") });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      id={`inbox-note-${note.id}`}
      data-testid="inbox-note"
      data-deleted={note.deleted ? "true" : undefined}
      className="flex w-4/5 max-w-4/5 flex-col items-end gap-0.5 self-end"
    >
      <span className="text-11 text-text-tertiary flex items-center gap-1">
        <Lock className="text-note-text size-3" aria-hidden />
        <span className="text-note-text font-medium">{t("notes.private")}</span>
        · {author} ·{" "}
        {format.dateTime(new Date(note.createdAt), { timeStyle: "short" })}
        {note.editedAt && !note.deleted ? (
          <span data-testid="inbox-note-edited"> · {t("notes.edited")}</span>
        ) : null}
      </span>
      <div
        className={cn(
          "rounded-inner border-note-border bg-surface-note-subtle text-14 text-text flex max-w-full items-start gap-1 border py-2 pr-1 pl-3 transition-shadow",
          highlighted && "ring-focus-ring ring-2",
          editing && "w-full",
        )}
      >
        {note.deleted ? (
          <span className="text-text-tertiary py-0.5 pr-2 italic">
            {t("notes.deletedNote")}
          </span>
        ) : editing ? (
          <form
            className="flex w-full flex-col gap-2 pr-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Textarea
              value={text}
              autoFocus
              rows={2}
              maxLength={4000}
              aria-label={t("notes.editLabel")}
              className="bg-surface-card max-h-40 min-h-12 resize-none"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void save();
                } else if (event.key === "Escape") {
                  setEditing(false);
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                {t("notes.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={busy || !text.trim()}>
                {t("notes.save")}
              </Button>
            </div>
          </form>
        ) : (
          <span className="min-w-0 py-0.5 break-words whitespace-pre-wrap">
            {note.body}
          </span>
        )}
        {changeable && !editing ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={busy}
                aria-label={t("notes.menu")}
                data-testid="inbox-note-menu"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (keepFocus.current) event.preventDefault();
                keepFocus.current = false;
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  keepFocus.current = true;
                  setText(note.body);
                  setEditing(true);
                }}
              >
                <Pencil />
                {t("notes.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void remove()}
              >
                <Trash2 />
                {t("notes.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}
