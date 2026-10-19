"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Room } from "matrix-js-sdk";

import { Accordion } from "@/components/ui/accordion";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  memberName,
  replyAttendants,
  roomConversation,
} from "../client/room-data";
import type { ContextTab, ConversationSummary, LabelView } from "../views";
import { ActionsSection } from "./actions-section";
import { ContactCard } from "./contact-card";
import { GuidsCard } from "./guids-card";
import { LabelsCard } from "./labels-card";
import type { ConversationCommand, InboxViewer } from "./types";

/**
 * Context of the open conversation (IN4a): the contact, the status and the
 * assignee, with what the person may do from here. Who answers takes,
 * resolves and reopens; who manages the Inbox assigns. Labels, the CRM
 * contact and the tools of the panel come later (IN4b, IN5). The state the
 * room holds wins over the mirror, which follows a moment later.
 * IN4c: the panel has two tabs, "Contato" (all of the above, open first)
 * and "Threads", empty until the backstage threads (SB1). "Contato" is the
 * `cards` accordion of the model components: Contato and Ações da
 * conversa (the old "Atendimento") start open; GUIDS and Etiquetas closed.
 */
export function ContextPanel({
  workspaceSlug,
  roomId,
  room,
  summary,
  viewer,
  me,
  busy,
  revision,
  onCommand,
  labels,
  onChanged,
  tab,
  onTab,
  sections,
  onSections,
}: Readonly<{
  workspaceSlug: string;
  roomId: string | null;
  room: Room | null;
  summary: ConversationSummary | null;
  viewer: InboxViewer;
  me: string | null;
  busy: boolean;
  revision: number;
  onCommand: (command: ConversationCommand) => void;
  labels: readonly LabelView[];
  /** Something changed from a card of its own: refresh the list. */
  onChanged: () => Promise<void>;
  tab: ContextTab;
  onTab: (tab: ContextTab) => void;
  /** The open sections of "Contato" (kept by the window). */
  sections: readonly string[];
  onSections: (sections: string[]) => void;
}>) {
  const t = useTranslations("inbox");
  const state = useMemo(() => {
    void revision;
    return (
      roomConversation(room) ??
      (summary ? { status: summary.status, assignee: summary.assignee } : null)
    );
  }, [room, summary, revision]);
  const candidates = useMemo(() => {
    void revision;
    return replyAttendants(room);
  }, [room, revision]);

  const shell = (content: React.ReactNode) => (
    <aside
      className="flex h-full min-h-0 flex-col"
      aria-label={t("context.title")}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => onTab(value as ContextTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-border flex h-15 shrink-0 items-center border-b px-3">
          <TabsList
            variant="segmented"
            className="w-full"
            aria-label={t("tabs.label")}
            data-testid="inbox-context-tabs"
          >
            <TabsTrigger value="contact">{t("tabs.contact")}</TabsTrigger>
            <TabsTrigger value="threads">{t("tabs.threads")}</TabsTrigger>
          </TabsList>
        </div>
        {content}
      </Tabs>
    </aside>
  );

  if (!roomId || !state) {
    return shell(
      <p className="text-12 text-text-tertiary p-4">{t("context.empty")}</p>,
    );
  }

  if (tab === "threads") {
    return shell(
      <Empty className="flex-1 p-6" data-testid="inbox-threads">
        <EmptyHeader>
          <EmptyTitle>{t("tabs.threadsTitle")}</EmptyTitle>
          <EmptyDescription>{t("tabs.threadsDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
  }

  const answers = viewer.level === "reply";
  const consumer = summary?.consumerMxid ?? null;
  const assigneeName =
    state.assignee === null
      ? t("nobody")
      : state.assignee === me
        ? t("you")
        : (memberName(room, state.assignee) ?? state.assignee);

  return shell(
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-3" data-testid="inbox-context">
        <Accordion
          type="multiple"
          variant="cards"
          value={[...sections]}
          onValueChange={onSections}
        >
          <ContactCard
            workspaceSlug={workspaceSlug}
            roomId={roomId}
            fallbackName={
              summary?.consumerName ??
              memberName(room, consumer) ??
              t("unknownContact")
            }
            chatId={consumer}
          />
          <ActionsSection
            status={state.status}
            assignee={state.assignee}
            assigneeName={assigneeName}
            candidates={candidates}
            me={me}
            answers={answers}
            manages={viewer.manages}
            busy={busy}
            onCommand={onCommand}
          />
          <GuidsCard
            workspaceSlug={workspaceSlug}
            roomId={roomId}
            status={state.status}
            assignee={state.assignee}
            answers={answers}
            onChanged={onChanged}
          />
          <LabelsCard
            workspaceSlug={workspaceSlug}
            roomId={roomId}
            viewer={viewer}
            labels={labels}
            active={summary?.labelIds ?? []}
            onChanged={onChanged}
          />
        </Accordion>
      </div>
    </ScrollArea>,
  );
}
