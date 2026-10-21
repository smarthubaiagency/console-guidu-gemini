"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type {
  MessageTranslationDto,
  TranslationNotice,
} from "../server/translation";
import { loadMessageTranslationsAction } from "../translation-actions";

/**
 * Translated messages in the conversation (TR2, traducao.md §5.1): the
 * window asks the server for the translations of the messages in view,
 * again when messages arrive and while one is being translated. A
 * translated message shows the team's language, the language it came in
 * and the engine, with "Ver original" in place; while translating, the
 * original with "Traduzindo…"; on a failure, the original with "Tradução
 * indisponível".
 * TR3: the team's own answer, sent translated, shows what the attendant
 * wrote and "Enviado em espanhol · motor", with "Ver enviado" to see the
 * text the contact received; an edited preview is marked.
 */

const PENDING_POLL_MS = 3_000;
/** After new messages: the core may still be processing them. */
const FOLLOW_UPS_MS = [2_500, 7_000];
const MAX_IDS = 200;

export type MessageTranslations = Readonly<{
  byEvent: ReadonlyMap<string, MessageTranslationDto>;
  notice: TranslationNotice | null;
  /** Asks the server again now (after recording a sent answer). */
  refresh: () => void;
}>;

export function useMessageTranslations(
  workspaceSlug: string,
  roomId: string | null,
  eventIds: readonly string[],
): MessageTranslations {
  const [state, setState] = useState<{
    byEvent: ReadonlyMap<string, MessageTranslationDto>;
    notice: TranslationNotice | null;
    roomId: string | null;
  }>({ byEvent: new Map(), notice: null, roomId: null });
  const ids = useMemo(
    () => eventIds.filter((id) => id.startsWith("$")).slice(-MAX_IDS),
    [eventIds],
  );
  const key = ids.join(",");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!roomId || !key) return;
    let stopped = false;
    const read = async () => {
      const result = await loadMessageTranslationsAction({
        workspaceSlug,
        roomId,
        eventIds: key.split(","),
      }).catch(() => null);
      if (stopped || !result || "error" in result) return;
      setState({
        roomId,
        byEvent: new Map(result.translations.map((t) => [t.eventId, t])),
        notice: result.notice,
      });
    };
    void read();
    const timers = FOLLOW_UPS_MS.map((ms) => window.setTimeout(read, ms));
    return () => {
      stopped = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
    // `key` stands for the ids; `tick` asks again while one is pending.
  }, [workspaceSlug, roomId, key, tick]);

  const current =
    state.roomId === roomId ? state : { byEvent: new Map(), notice: null };
  const pending = [...current.byEvent.values()].some(
    (t) => t.status === "pending",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(
      () => setTick((n) => n + 1),
      PENDING_POLL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pending, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { byEvent: current.byEvent, notice: current.notice, refresh };
}

/** The body of a message, translated when there is a translation. */
export function TranslatedBody({
  body,
  translation,
}: Readonly<{
  body: string;
  translation: MessageTranslationDto | undefined;
}>) {
  const t = useTranslations("inbox.translation");
  const [original, setOriginal] = useState(false);
  if (!translation) return <>{body}</>;
  if (translation.direction === "outbound") {
    return <SentBody body={body} translation={translation} />;
  }
  if (translation.status !== "done" || !translation.text) {
    return (
      <>
        {body}
        <span
          className="text-11 mt-1 block opacity-70"
          data-testid="inbox-translation-state"
        >
          {translation.status === "pending" ? t("pending") : t("unavailable")}
        </span>
      </>
    );
  }
  const from = translation.sourceLocale
    ? t(`languages.${translation.sourceLocale}`)
    : null;
  const engine = translation.engine ? t(`engines.${translation.engine}`) : "";
  return (
    <>
      <span data-testid="inbox-translated-text">
        {original ? body : translation.text}
      </span>
      <span className="text-11 mt-1 flex flex-wrap items-center gap-x-1 opacity-70">
        <span data-testid="inbox-translation-meta">
          {from
            ? t("translatedFrom", { language: from, engine })
            : t("translated", { engine })}
          {translation.fallback ? ` · ${t("fallback")}` : ""}
        </span>
        <span aria-hidden="true">·</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className={cn("text-11 h-auto p-0 text-current underline")}
          onClick={() => setOriginal((value) => !value)}
          data-testid="inbox-translation-toggle"
        >
          {original ? t("showTranslation") : t("showOriginal")}
        </Button>
      </span>
    </>
  );
}

/** A failing engine, in the window (as in the settings). */
export function TranslationNoticeBar({
  notice,
}: Readonly<{ notice: TranslationNotice | null }>) {
  const t = useTranslations("inbox.translation");
  if (!notice) return null;
  return (
    <Alert
      variant={notice.failed ? "destructive" : "default"}
      className="rounded-none border-x-0 border-t-0"
      data-testid="inbox-translation-notice"
    >
      <TriangleAlert />
      <AlertTitle>
        {notice.failed ? t("notice.failed") : t("notice.fallback")}
      </AlertTitle>
      <AlertDescription>{t(`errorCodes.${notice.code}`)}</AlertDescription>
    </Alert>
  );
}

/**
 * The team's answer that went translated (TR3): the original in the team's
 * language, then the language it was sent in and the engine, with "Ver
 * enviado" to switch to the text the contact received.
 */
function SentBody({
  body,
  translation,
}: Readonly<{
  body: string;
  translation: MessageTranslationDto;
}>) {
  const t = useTranslations("inbox.translation");
  const [sent, setSent] = useState(false);
  if (translation.status !== "done" || !translation.original)
    return <>{body}</>;
  const to = translation.targetLocale
    ? t(`languages.${translation.targetLocale}`)
    : null;
  const engine = translation.engine ? t(`engines.${translation.engine}`) : "";
  return (
    <>
      <span data-testid="inbox-sent-text">
        {sent ? (translation.text ?? body) : translation.original}
      </span>
      <span className="text-11 mt-1 flex flex-wrap items-center gap-x-1 opacity-70">
        <span data-testid="inbox-sent-meta">
          {to ? t("sentIn", { language: to, engine }) : t("sent", { engine })}
          {translation.fallback ? ` · ${t("fallback")}` : ""}
          {translation.edited ? ` · ${t("edited")}` : ""}
        </span>
        <span aria-hidden="true">·</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className={cn("text-11 h-auto p-0 text-current underline")}
          onClick={() => setSent((value) => !value)}
          data-testid="inbox-sent-toggle"
        >
          {sent ? t("showWritten") : t("showSent")}
        </Button>
      </span>
    </>
  );
}
