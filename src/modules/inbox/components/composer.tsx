"use client";

import {
  Loader2,
  MoreHorizontal,
  Paperclip,
  SendHorizontal,
  Smile,
  StickyNote,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** What the box writes (IN5a): an answer to the contact or a team note. */
export type ComposerMode = "reply" | "note";

/**
 * The message box of the conversation (IN4c), in the shape of the AI agent
 * chats (the GMN specialist): the field on top and a bar below it, with the
 * tools that come later on the left and "Enviar" on the right. Enter sends,
 * Shift+Enter breaks the line. IN5a: in `note` mode the same box writes a
 * private note (amber field, its own hint and "Adicionar nota"); the
 * frame with the tabs is `ComposerFrame`.
 */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  mode = "reply",
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  mode?: ComposerMode;
}>) {
  const t = useTranslations("inbox");
  const soon = [
    { key: "attach", label: t("composer.attach"), Icon: Paperclip },
    { key: "emoji", label: t("composer.emoji"), Icon: Smile },
    { key: "more", label: t("composer.more"), Icon: MoreHorizontal },
  ] as const;
  const note = mode === "note";
  const action = note ? t("notes.add") : t("send");
  return (
    <form
      data-testid="inbox-composer"
      data-mode={mode}
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <InputGroup
        className={cn(
          "rounded-card",
          note
            ? "border-note-border bg-surface-note-subtle dark:bg-surface-note-subtle"
            : "bg-surface-card dark:bg-surface-card",
        )}
      >
        <InputGroupTextarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          rows={2}
          placeholder={note ? t("notes.hint") : t("composer.hint")}
          aria-label={note ? t("notes.fieldLabel") : t("messagePlaceholder")}
          disabled={disabled}
          className="max-h-40 min-h-12 resize-none"
        />
        <InputGroupAddon align="block-end">
          {soon.map(({ key, label, Icon }) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  aria-label={label}
                  aria-disabled="true"
                  className="cursor-not-allowed opacity-50"
                  onClick={(event) => event.preventDefault()}
                  data-testid={`inbox-composer-${key}`}
                >
                  <Icon />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
          <InputGroupButton
            type="submit"
            variant="default"
            size="sm"
            className="ml-auto"
            disabled={disabled || sending || !value.trim()}
            aria-label={action}
          >
            {sending ? (
              <Loader2 className="animate-spin" />
            ) : note ? (
              <StickyNote />
            ) : (
              <SendHorizontal />
            )}
            {action}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
