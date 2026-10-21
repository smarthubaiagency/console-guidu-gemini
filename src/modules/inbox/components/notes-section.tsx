"use client";

import { Lock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";

import type { InboxNoteView } from "../server/notes";
import { PanelSection } from "./panel-section";

/**
 * "Notas" of the "Contato" tab (IN5a): the count and the private notes of
 * the conversation, the newest first; a click takes the conversation to
 * the note. Closed at first (the window keeps the open sections).
 */
export function NotesSection({
  notes,
  onShow,
}: Readonly<{
  notes: readonly InboxNoteView[];
  onShow: (noteId: string) => void;
}>) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const newest = [...notes].reverse();
  return (
    <PanelSection
      value="notes"
      title={t("notes.title")}
      testId="inbox-notes"
      badge={
        <Badge variant="neutral" data-testid="inbox-notes-count">
          {notes.length}
        </Badge>
      }
    >
      {newest.length === 0 ? (
        <p className="text-12 text-text-secondary">{t("notes.empty")}</p>
      ) : (
        <ItemGroup className="gap-2">
          {newest.map((note) => {
            const author = note.mine
              ? t("you")
              : (note.authorName ?? t("notes.unknownAuthor"));
            return (
              <Item
                key={note.id}
                asChild
                size="sm"
                variant="inset"
                className="bg-surface-note-subtle hover:bg-surface-note cursor-pointer px-3 py-2"
              >
                <a
                  href={`#inbox-note-${note.id}`}
                  aria-label={t("notes.show", { author })}
                  onClick={(event) => {
                    event.preventDefault();
                    onShow(note.id);
                  }}
                >
                  <ItemContent className="min-w-0 gap-0.5">
                    <ItemTitle className="text-12 text-text-secondary flex items-center gap-1 font-normal">
                      <Lock className="text-note-text size-3" aria-hidden />
                      {author} ·{" "}
                      {format.dateTime(new Date(note.createdAt), {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </ItemTitle>
                    <ItemDescription
                      className={
                        note.deleted
                          ? "text-text-tertiary italic"
                          : "text-14 text-text line-clamp-2"
                      }
                    >
                      {note.deleted ? t("notes.deletedNote") : note.body}
                    </ItemDescription>
                  </ItemContent>
                </a>
              </Item>
            );
          })}
        </ItemGroup>
      )}
    </PanelSection>
  );
}
