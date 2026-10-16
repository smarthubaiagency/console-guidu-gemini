"use client";

import { Bot, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useStatus } from "@/components/feedback/status-context";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription } from "@/components/ui/item";

import type { AutomationArea } from "../areas";
import { askSpecialistAction } from "../server/actions";
import type { GbTarget } from "../server/target";

type Message = Readonly<{ role: "user" | "assistant"; content: string }>;

const HISTORY = 8;

/**
 * "Preciso saber mais" (GB1a): questions to the GMN specialist in the
 * drawer. It only answers; it changes nothing on the ficha.
 */
export function SpecialistChat({
  target,
  locationId,
  area,
}: Readonly<{ target: GbTarget; locationId: string; area: AutomationArea }>) {
  const t = useTranslations("googleBusiness.automation.agent");
  const { showStatus } = useStatus();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    const history = messages.slice(-HISTORY);
    setMessages((list) => [...list, { role: "user", content: question }]);
    setText("");
    const answer = await askSpecialistAction(target, locationId, {
      question,
      history,
      area,
    });
    setBusy(false);
    if (!answer.ok) {
      showStatus({ type: "down", title: t("error"), details: answer.error });
      return;
    }
    setMessages((list) => [
      ...list,
      { role: "assistant", content: answer.text },
    ]);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div
        className="flex flex-1 flex-col gap-2"
        data-testid="specialist-messages"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <Empty className="bg-surface-inset rounded-inner">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bot />
              </EmptyMedia>
              <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          messages.map((message, index) => (
            <Item
              key={index}
              variant={message.role === "user" ? "inset" : "card"}
              size="sm"
              data-role={message.role}
            >
              <ItemContent>
                <span className="text-11 text-text-tertiary">
                  {message.role === "user" ? t("you") : t("agentName")}
                </span>
                <ItemDescription className="text-text line-clamp-none whitespace-pre-wrap">
                  {message.content}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))
        )}
      </div>
      <InputGroup className="rounded-card">
        <InputGroupTextarea
          aria-label={t("label")}
          placeholder={t("placeholder")}
          value={text}
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          className="min-h-20"
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton
            variant="default"
            size="sm"
            className="ml-auto"
            onClick={() => void send()}
            disabled={busy || !text.trim()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {t("send")}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-11 text-text-tertiary">{t("notice")}</p>
    </div>
  );
}
