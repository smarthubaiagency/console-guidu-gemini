"use client";

import { Loader2, Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Composer, type ComposerMode } from "./composer";

/**
 * The frame of the message box (IN5a), as in Marcelo's reference: a grey
 * `surface-inset` frame (card-in-card, `rounded-card`) with the tabs
 * "Responder | Nota privada" on its top strip and the AI mark (✦) on the
 * right: with the translation on (TR3) it asks for the preview of the answer in
 * the contact's language without sending, otherwise it stays off; inside,
 * the box of the IN4c, or the preview in its place. In note mode the frame
 * turns amber (`surface-note`).
 */
export function ComposerFrame({
  mode,
  onMode,
  value,
  onChange,
  onSend,
  disabled,
  sending,
  preview = null,
  aiLabel,
  aiEnabled = false,
  aiBusy = false,
  onAi,
}: Readonly<{
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  /** TR3: the preview of the translation, shown in place of the box. */
  preview?: ReactNode;
  /** TR3: the label of the ✦; on when the answer would be translated. */
  aiLabel?: string;
  aiEnabled?: boolean;
  aiBusy?: boolean;
  onAi?: () => void;
}>) {
  const t = useTranslations("inbox.notes");
  const note = mode === "note";
  return (
    <div className="border-border border-t p-3">
      <Tabs
        value={mode}
        onValueChange={(value) => onMode(value === "note" ? "note" : "reply")}
        className={cn(
          "rounded-card gap-0 p-1 transition-colors",
          note ? "bg-surface-note" : "bg-surface-inset",
        )}
        data-testid="inbox-composer-frame"
        data-mode={mode}
      >
        <div className="flex h-9 items-center gap-2 pr-1 pl-2">
          <TabsList
            variant="line"
            aria-label={t("tabsLabel")}
            data-testid="inbox-composer-tabs"
          >
            <TabsTrigger value="reply">{t("reply")}</TabsTrigger>
            <TabsTrigger
              value="note"
              className={cn(note && "text-note-text dark:text-note-text")}
            >
              <Lock />
              {t("note")}
            </TabsTrigger>
          </TabsList>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "text-text-secondary ml-auto",
                  !aiEnabled && "cursor-not-allowed opacity-50",
                )}
                aria-label={aiLabel ?? t("ai")}
                aria-disabled={aiEnabled && !aiBusy ? undefined : "true"}
                onClick={(event) => {
                  event.preventDefault();
                  if (aiEnabled && !aiBusy) onAi?.();
                }}
                data-testid="inbox-composer-ai"
              >
                {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{aiLabel ?? t("ai")}</TooltipContent>
          </Tooltip>
        </div>
        {preview ?? (
          <Composer
            mode={mode}
            value={value}
            onChange={onChange}
            onSend={onSend}
            disabled={disabled}
            sending={sending}
          />
        )}
      </Tabs>
    </div>
  );
}
