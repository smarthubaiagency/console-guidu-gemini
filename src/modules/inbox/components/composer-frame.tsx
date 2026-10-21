"use client";

import { Lock, Sparkles } from "lucide-react";
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
 * right, off until the translation preview of the TR3; inside, the box of
 * the IN4c. In note mode the frame turns amber (`surface-note`).
 */
export function ComposerFrame({
  mode,
  onMode,
  value,
  onChange,
  onSend,
  disabled,
  sending,
}: Readonly<{
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
}>) {
  const t = useTranslations("inbox.notes");
  const note = mode === "note";
  return (
    <div className="p-3">
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
            <TabsTrigger value="reply" className="after:hidden">
              {t("reply")}
            </TabsTrigger>
            <TabsTrigger
              value="note"
              className={cn(
                "after:hidden",
                note && "text-note-text dark:text-note-text",
              )}
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
                className="text-text-secondary ml-auto cursor-not-allowed opacity-50"
                aria-label={t("ai")}
                aria-disabled="true"
                onClick={(event) => event.preventDefault()}
                data-testid="inbox-composer-ai"
              >
                <Sparkles />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("ai")}</TooltipContent>
          </Tooltip>
        </div>
        <Composer
          mode={mode}
          value={value}
          onChange={onChange}
          onSend={onSend}
          disabled={disabled}
          sending={sending}
        />
      </Tabs>
    </div>
  );
}
