"use client";

import { Loader2, SendHorizontal, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import type { ContactLocale } from "@/core/matrix/locale";
import type { TranslationEngineId } from "@/core/translation/types";

/**
 * The preview of the team's answer (TR3, traducao.md §5.2): in place of the
 * message box, the text in the contact's language, editable, with "Enviar
 * em <idioma>", "Enviar sem traduzir" and "Voltar". Nothing was sent to the
 * room yet. With both engines failing there is no text: "Tradução
 * indisponível" with "Tentar de novo", "Enviar sem traduzir" and "Voltar";
 * the window never sends by itself.
 */

export type OutboundPreviewState =
  | Readonly<{ phase: "loading"; target: ContactLocale }>
  | Readonly<{
      phase: "preview";
      /** What the attendant may edit; starts as the engine's text. */
      text: string;
      /** The engine's text, to tell an edited preview. */
      machineText: string;
      source: ContactLocale;
      target: ContactLocale;
      engine: TranslationEngineId;
      model: string | null;
      fallback: boolean;
    }>
  | Readonly<{ phase: "unavailable"; target: ContactLocale }>;

export function OutboundPreview({
  state,
  sending,
  onText,
  onSendTranslated,
  onSendOriginal,
  onRetry,
  onBack,
}: Readonly<{
  state: OutboundPreviewState;
  sending: boolean;
  onText: (text: string) => void;
  onSendTranslated: () => void;
  onSendOriginal: () => void;
  onRetry: () => void;
  onBack: () => void;
}>) {
  const t = useTranslations("inbox.translation");
  const language = t(`languages.${state.target}`);

  if (state.phase === "loading") {
    return (
      <div
        className="text-12 text-text-secondary flex items-center gap-2 px-3 py-4"
        role="status"
        data-testid="inbox-outbound-loading"
      >
        <Loader2 className="size-4 animate-spin" />
        {t("outbound.loading", { language })}
      </div>
    );
  }

  if (state.phase === "unavailable") {
    return (
      <div className="space-y-2" data-testid="inbox-outbound-unavailable">
        <Alert variant="destructive" className="rounded-card">
          <TriangleAlert />
          <AlertTitle>{t("unavailable")}</AlertTitle>
          <AlertDescription>
            {t("outbound.unavailableDescription")}
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            disabled={sending}
            data-testid="inbox-outbound-back"
          >
            {t("outbound.back")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSendOriginal}
            disabled={sending}
            data-testid="inbox-outbound-send-original"
          >
            {t("outbound.sendOriginal")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onRetry}
            disabled={sending}
            data-testid="inbox-outbound-retry"
          >
            {t("outbound.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const engine = t(`engines.${state.engine}`);
  return (
    <InputGroup
      className="rounded-card bg-surface-card dark:bg-surface-card"
      data-testid="inbox-outbound-preview"
    >
      <InputGroupAddon align="block-start">
        <span className="text-12 text-text-secondary">
          {t("outbound.previewTitle", { language })}
        </span>
        <span
          className="text-11 text-text-tertiary ml-auto"
          data-testid="inbox-outbound-meta"
        >
          {engine}
          {state.fallback ? ` · ${t("fallback")}` : ""}
        </span>
      </InputGroupAddon>
      <InputGroupTextarea
        value={state.text}
        onChange={(event) => onText(event.target.value)}
        rows={3}
        aria-label={t("outbound.fieldLabel", { language })}
        disabled={sending}
        className="max-h-40 min-h-16 resize-none"
        data-testid="inbox-outbound-text"
      />
      <InputGroupAddon align="block-end" className="flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={sending}
          data-testid="inbox-outbound-back"
        >
          {t("outbound.back")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onSendOriginal}
          disabled={sending}
          data-testid="inbox-outbound-send-original"
        >
          {t("outbound.sendOriginal")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSendTranslated}
          disabled={sending || !state.text.trim()}
          data-testid="inbox-outbound-send"
        >
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
          {t("outbound.sendIn", { language })}
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
