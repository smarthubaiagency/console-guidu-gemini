"use client";

import {
  Loader2,
  MoreHorizontal,
  Paperclip,
  SendHorizontal,
  Smile,
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

/**
 * The message box of the conversation (IN4c), in the shape of the AI agent
 * chats (the GMN specialist): the field on top and a bar below it, with the
 * tools that come later on the left and "Enviar" on the right. Enter sends,
 * Shift+Enter breaks the line.
 */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  sending,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
}>) {
  const t = useTranslations("inbox");
  const soon = [
    { key: "attach", label: t("composer.attach"), Icon: Paperclip },
    { key: "emoji", label: t("composer.emoji"), Icon: Smile },
    { key: "more", label: t("composer.more"), Icon: MoreHorizontal },
  ] as const;
  return (
    <form
      className="border-border border-t p-3"
      data-testid="inbox-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <InputGroup className="rounded-card">
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
          placeholder={t("composer.hint")}
          aria-label={t("messagePlaceholder")}
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
            aria-label={t("send")}
          >
            {sending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <SendHorizontal />
            )}
            {t("send")}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
