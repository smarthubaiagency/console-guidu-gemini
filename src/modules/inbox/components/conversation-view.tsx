"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, PanelRight, SendHorizontal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { MatrixClient, Room } from "matrix-js-sdk";

import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { memberName, timeline, typingNames } from "../client/room-data";
import type { MatrixPhase } from "../client/use-inbox-matrix";
import type { ConversationSummary } from "../views";
import type { InboxViewer } from "./types";

/**
 * The open conversation (IN4a): the timeline of the room, who is typing,
 * the consumer's presence and the message box. Who only reads (an owner
 * or admin who is not an attendant) sees no box: the room does not let
 * them send either (power 0).
 */

const PRESENCE_MS = 30_000;
const TYPING_MS = 5_000;

export function ConversationView({
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
}: Readonly<{
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
}>) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const { showStatus } = useStatus();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
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
  }, [messages.length, roomId]);

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
            {messages.map((message) => (
              <li
                key={message.id}
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
                  {message.body}
                </span>
              </li>
            ))}
            <div ref={bottom} />
          </ol>
        )}
      </ScrollArea>

      {viewer.level === "reply" ? (
        <form
          className="border-border flex items-end gap-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={t("messagePlaceholder")}
            aria-label={t("messagePlaceholder")}
            disabled={!canSend}
            className="max-h-40 min-h-10 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend || sending || !draft.trim()}
            aria-label={t("send")}
          >
            <SendHorizontal />
          </Button>
        </form>
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
