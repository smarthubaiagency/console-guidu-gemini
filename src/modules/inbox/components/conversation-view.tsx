"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, PanelRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { MatrixClient, Room } from "matrix-js-sdk";

import { useStatus } from "@/components/feedback/status-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  memberName,
  timeline,
  type TimelineMessage,
  typingNames,
} from "../client/room-data";
import { mergeTimeline } from "../client/timeline";
import type { MatrixPhase } from "../client/use-inbox-matrix";
import { createNoteAction } from "../notes-actions";
import type { InboxNoteView } from "../server/notes";
import type { MessageTranslationDto } from "../server/translation";
import type { ConversationSummary } from "../views";
import type { ComposerMode } from "./composer";
import { ComposerFrame } from "./composer-frame";
import { ContactLocaleChip } from "./contact-locale";
import { useAnsweredBy } from "./use-answered-by";
import {
  TranslatedBody,
  TranslationNoticeBar,
  useMessageTranslations,
} from "./message-translation";
import { NoteBubble } from "./note-bubble";
import type { InboxViewer } from "./types";

/**
 * The open conversation (IN4a): the timeline of the room, who is typing,
 * the consumer's presence and the message box (IN4c: in the shape of the
 * AI agent chats). Who only reads (an owner
 * or admin who is not an attendant) sees no box: the room does not let
 * them send either (power 0).
 * IN5a: the private notes of the team enter the timeline by date, and the
 * box switches between "Responder" and "Nota privada" (the mode is kept by
 * the window: "Novo › Nova nota" opens it). A note goes to the database,
 * never to the room; each mode keeps its own draft.
 */

const PRESENCE_MS = 30_000;
const TYPING_MS = 5_000;

export function ConversationView({
  workspaceSlug,
  roomId,
  room,
  client,
  phase,
  revision,
  me,
  viewer,
  summary,
  onBack,
  onShowContext,
  onChanged,
  notes,
  onNotesChanged,
  mode,
  onMode,
  highlightedNote,
}: Readonly<{
  workspaceSlug: string;
  roomId: string | null;
  room: Room | null;
  client: MatrixClient | null;
  phase: MatrixPhase;
  revision: number;
  me: string | null;
  viewer: InboxViewer;
  summary: ConversationSummary | null;
  onBack: (() => void) | null;
  onShowContext: (() => void) | null;
  /** The contact's language changed (TR1): refresh the list. */
  onChanged: () => Promise<void>;
  /** IN5a: the private notes of the conversation and their refresh. */
  notes: readonly InboxNoteView[];
  onNotesChanged: () => Promise<void>;
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  highlightedNote: string | null;
}>) {
  const t = useTranslations("inbox");
  const { showStatus } = useStatus();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // The note draft belongs to its conversation (IN5a).
  const [noteDraft, setNoteDraft] = useState<{
    roomId: string | null;
    text: string;
  }>({ roomId: null, text: "" });
  const noteText = noteDraft.roomId === roomId ? noteDraft.text : "";
  const [presenceOf, setPresenceOf] = useState<{
    mxid: string;
    value: string | null;
  } | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const typingSent = useRef(0);

  const messages = useMemo(() => {
    void revision;
    return timeline(room, me);
  }, [room, me, revision]);
  // TR2: the translations of the messages in view.
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const translations = useMessageTranslations(
    workspaceSlug,
    roomId,
    messageIds,
  );
  // GF2: who wrote the answers of the GUIDS (the team's window only).
  const answeredBy = useAnsweredBy(workspaceSlug, roomId, messages);
  const items = useMemo(
    () => mergeTimeline(messages, notes),
    [messages, notes],
  );
  const typing = useMemo(() => {
    void revision;
    return typingNames(room, me);
  }, [room, me, revision]);
  const consumer = summary?.consumerMxid ?? null;
  const name =
    summary?.consumerName ?? memberName(room, consumer) ?? t("unknownContact");
  const presence =
    presenceOf && presenceOf.mxid === consumer ? presenceOf.value : null;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items.length, roomId]);

  // The consumer's presence, asked from time to time (Sliding Sync has no
  // presence extension).
  useEffect(() => {
    if (!client || !consumer) return;
    let stopped = false;
    const ask = () =>
      client
        .getPresence(consumer)
        .then((value) => {
          if (!stopped) {
            setPresenceOf({ mxid: consumer, value: value.presence ?? null });
          }
        })
        .catch(() => undefined);
    void ask();
    const timer = window.setInterval(ask, PRESENCE_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [client, consumer]);

  // Read receipt of the last message (unread counts arrive with the IN4b).
  const lastId = messages.at(-1)?.id ?? null;
  useEffect(() => {
    if (!client || !room || !lastId) return;
    const event = room.findEventById(lastId);
    if (event) client.sendReadReceipt(event).catch(() => undefined);
  }, [client, room, lastId]);

  if (!roomId) {
    return (
      <Empty className="h-full" data-testid="inbox-no-conversation">
        <EmptyHeader>
          <EmptyTitle>{t("noConversationTitle")}</EmptyTitle>
          <EmptyDescription>{t("noConversationDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const canSend = viewer.level === "reply" && phase === "ready" && !!room;
  // A note does not need the chat: only the database.
  const canNote = viewer.level === "reply";

  const addNote = async () => {
    const body = noteText.trim();
    if (!roomId || !body || sending) return;
    setSending(true);
    try {
      const result = await createNoteAction({ workspaceSlug, roomId, body });
      if ("error" in result) {
        showStatus({ type: "down", title: result.error });
        return;
      }
      setNoteDraft({ roomId, text: "" });
      showStatus({ type: "up", title: t("notes.added") });
      await onNotesChanged();
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!client || !roomId || !body || sending) return;
    setSending(true);
    try {
      await client.sendTextMessage(roomId, body);
      setDraft("");
      typingSent.current = 0;
      client.sendTyping(roomId, false, 0).catch(() => undefined);
    } catch {
      showStatus({ type: "down", title: t("sendFailed") });
    } finally {
      setSending(false);
    }
  };

  const onDraft = (value: string) => {
    setDraft(value);
    if (!client || !roomId) return;
    const now = Date.now();
    if (value && now - typingSent.current > TYPING_MS / 2) {
      typingSent.current = now;
      client.sendTyping(roomId, true, TYPING_MS).catch(() => undefined);
    } else if (!value && typingSent.current) {
      typingSent.current = 0;
      client.sendTyping(roomId, false, 0).catch(() => undefined);
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("conversationLabel", { name })}
      data-testid="inbox-conversation"
    >
      <header className="border-border flex h-15 shrink-0 items-center gap-2 border-b px-3">
        {onBack ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onBack}
            aria-label={t("back")}
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-14 text-text truncate font-semibold">{name}</h2>
          <p
            className="text-11 text-text-tertiary"
            data-testid="inbox-presence"
          >
            {typing.length > 0
              ? t("typing", { names: typing.join(", ") })
              : presence
                ? t(
                    `presence.${presence === "online" || presence === "unavailable" ? presence : "offline"}`,
                  )
                : " "}
          </p>
        </div>
        {roomId ? (
          <ContactLocaleChip
            workspaceSlug={workspaceSlug}
            roomId={roomId}
            viewer={viewer}
            summary={summary}
            onChanged={onChanged}
          />
        ) : null}
        {onShowContext ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onShowContext}
            aria-label={t("context.title")}
          >
            <PanelRight />
          </Button>
        ) : null}
      </header>

      <TranslationNoticeBar notice={translations.notice} />

      <ScrollArea className="min-h-0 flex-1">
        {phase === "error" ? (
          <p className="text-12 text-danger-text p-4" role="alert">
            {t("chatUnavailable")}
          </p>
        ) : !room ? (
          <div className="space-y-3 p-4" aria-busy="true">
            <Skeleton className="rounded-inner h-10 w-2/3" />
            <Skeleton className="rounded-inner ml-auto h-10 w-1/2" />
          </div>
        ) : (
          <ol className="flex flex-col gap-2 p-4" data-testid="inbox-timeline">
            {items.map((item) =>
              item.kind === "note" ? (
                <NoteBubble
                  key={item.key}
                  workspaceSlug={workspaceSlug}
                  note={item.note}
                  canWrite={canNote}
                  highlighted={highlightedNote === item.note.id}
                  onChanged={onNotesChanged}
                />
              ) : (
                <MessageItem
                  key={item.key}
                  message={item.message}
                  translation={translations.byEvent.get(item.message.id)}
                  answeredBy={answeredBy.get(item.message.id)}
                />
              ),
            )}
            <div ref={bottom} />
          </ol>
        )}
      </ScrollArea>

      {viewer.level === "reply" ? (
        <ComposerFrame
          mode={mode}
          onMode={onMode}
          value={mode === "note" ? noteText : draft}
          onChange={
            mode === "note" ? (text) => setNoteDraft({ roomId, text }) : onDraft
          }
          onSend={() => void (mode === "note" ? addNote() : send())}
          disabled={mode === "note" ? !canNote : !canSend}
          sending={sending}
        />
      ) : (
        <p
          className="border-border text-12 text-text-secondary border-t p-3"
          data-testid="inbox-read-only"
        >
          {t("readOnly")}
        </p>
      )}
    </section>
  );
}

/** A message of the room (IN4a), with its translation (TR2). */
function MessageItem({
  message,
  translation,
  answeredBy,
}: Readonly<{
  message: TimelineMessage;
  translation: MessageTranslationDto | undefined;
  answeredBy: "attendant" | "seller" | undefined;
}>) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  return (
    <li
      className={cn(
        "flex max-w-4/5 flex-col gap-0.5",
        message.mine ? "items-end self-end" : "items-start",
      )}
    >
      <span className="text-11 text-text-tertiary">
        {message.mine ? t("you") : message.senderName} ·{" "}
        {format.dateTime(new Date(message.ts), {
          timeStyle: "short",
        })}
      </span>
      <span
        className={cn(
          "rounded-inner text-14 px-3 py-2 break-words whitespace-pre-wrap",
          message.mine
            ? "bg-primary text-primary-foreground"
            : "bg-surface-inset text-text",
        )}
      >
        <TranslatedBody body={message.body} translation={translation} />
      </span>
      {answeredBy ? (
        // GF2: only the team's window; the contact never sees it.
        <Badge
          variant="neutral"
          data-testid="inbox-answered-by"
          data-role={answeredBy}
        >
          {t(`answeredBy.${answeredBy}`)}
        </Badge>
      ) : null}
    </li>
  );
}
