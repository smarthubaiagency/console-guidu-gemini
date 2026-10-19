"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { KeyValueList } from "@/components/patterns/key-value-list";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";

import {
  conversationContactAction,
  linkContactAction,
  searchContactsAction,
} from "../actions";
import type { ConversationContact } from "../server/contacts";

import { PanelSection } from "./panel-section";

/**
 * The CRM contact of the open conversation (IN4b): name, phone, e-mail and
 * company, from the CRM's public service. Who also reads the CRM can link
 * the conversation to another contact when they find out who it is.
 */
export function ContactCard({
  workspaceSlug,
  roomId,
  fallbackName,
  chatId,
}: Readonly<{
  workspaceSlug: string;
  roomId: string;
  fallbackName: string;
  chatId: string | null;
}>) {
  const t = useTranslations("inbox");
  const { showStatus } = useStatus();
  const [loaded, setLoaded] = useState<{
    roomId: string;
    contact: ConversationContact;
  } | null>(null);
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; detail: string | null }[]
  >([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let stopped = false;
    void conversationContactAction({ workspaceSlug, roomId }).then((result) => {
      if (!stopped && "contact" in result) {
        setLoaded({ roomId, contact: result.contact });
      }
    });
    return () => {
      stopped = true;
    };
  }, [workspaceSlug, roomId, revision]);

  useEffect(() => {
    if (!linking) return;
    let stopped = false;
    const timer = window.setTimeout(() => {
      void searchContactsAction({ workspaceSlug, query }).then((result) => {
        if (!stopped && "contacts" in result) setResults(result.contacts);
      });
    }, 250);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [linking, query, workspaceSlug]);

  const contact = loaded?.roomId === roomId ? loaded.contact : null;

  const link = async (contactId: string) => {
    const result = await linkContactAction({
      workspaceSlug,
      roomId,
      contactId,
    });
    if ("error" in result) {
      showStatus({ type: "down", title: result.error });
      return;
    }
    showStatus({ type: "up", title: t("contact.linked") });
    setLinking(false);
    setQuery("");
    setRevision((value) => value + 1);
  };

  return (
    <PanelSection
      value="contact"
      title={t("context.contact")}
      testId="inbox-contact"
    >
      {!contact ? (
        <Skeleton className="rounded-inner h-16 w-full" />
      ) : (
        <>
          <KeyValueList
            items={[
              {
                label: t("context.name"),
                value: contact.card?.name ?? fallbackName,
              },
              ...(contact.card?.phone
                ? [{ label: t("contact.phone"), value: contact.card.phone }]
                : []),
              ...(contact.card?.email
                ? [{ label: t("contact.email"), value: contact.card.email }]
                : []),
              ...(contact.card?.companyName
                ? [
                    {
                      label: t("contact.company"),
                      value: contact.card.companyName,
                    },
                  ]
                : []),
              {
                label: t("context.chatId"),
                value: (
                  <span className="text-11 font-mono break-all">
                    {chatId ?? "—"}
                  </span>
                ),
              },
            ]}
          />
          {contact.card ? null : (
            <p className="text-12 text-text-secondary">
              {t(`contact.state.${contact.state}`)}
            </p>
          )}
          {contact.canLink ? (
            linking ? (
              <div className="space-y-2">
                <InputGroup>
                  <InputGroupInput
                    type="search"
                    value={query}
                    autoFocus
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("contact.search")}
                    aria-label={t("contact.search")}
                  />
                </InputGroup>
                <ul className="space-y-1" role="list">
                  {results.map((result) => (
                    <li key={result.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full flex-col items-start gap-0 py-1.5 text-left"
                        onClick={() => void link(result.id)}
                      >
                        <span className="text-12 font-medium">
                          {result.name}
                        </span>
                        {result.detail ? (
                          <span className="text-11 text-text-tertiary">
                            {result.detail}
                          </span>
                        ) : null}
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setLinking(false)}
                >
                  {t("contact.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLinking(true)}
              >
                {t("contact.link")}
              </Button>
            )
          ) : null}
        </>
      )}
    </PanelSection>
  );
}
