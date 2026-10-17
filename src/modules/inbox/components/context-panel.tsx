"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Room } from "matrix-js-sdk";

import { KeyValueList } from "@/components/patterns/key-value-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  memberName,
  replyAttendants,
  roomConversation,
} from "../client/room-data";
import type { ConversationSummary } from "../views";
import type { LabelView } from "../views";
import { ContactCard } from "./contact-card";
import { GuidsCard } from "./guids-card";
import { LabelsCard } from "./labels-card";
import { StatusBadge } from "./status-badge";
import type { ConversationCommand, InboxViewer } from "./types";

/**
 * Context of the open conversation (IN4a): the contact, the status and the
 * assignee, with what the person may do from here. Who answers takes,
 * resolves and reopens; who manages the Inbox assigns. Labels, the CRM
 * contact and the tools of the panel come later (IN4b, IN5). The state the
 * room holds wins over the mirror, which follows a moment later.
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

  if (!roomId || !state) {
    return (
      <aside
        className="text-12 text-text-tertiary h-full p-4"
        aria-label={t("context.title")}
      >
        {t("context.empty")}
      </aside>
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

  return (
    <aside className="h-full min-h-0" aria-label={t("context.title")}>
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4" data-testid="inbox-context">
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

          <Card variant="surface">
            <CardHeader>
              <CardTitle className="text-14">
                {t("context.attendance")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <KeyValueList
                items={[
                  {
                    label: t("context.status"),
                    value: <StatusBadge status={state.status} />,
                  },
                  {
                    label: t("context.assignee"),
                    value: (
                      <span data-testid="inbox-assignee">{assigneeName}</span>
                    ),
                  },
                ]}
              />
              {answers ? (
                <div className="flex flex-wrap gap-2">
                  {state.status !== "resolved" && state.assignee !== me ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => onCommand({ kind: "take" })}
                    >
                      {t("actions.take")}
                    </Button>
                  ) : null}
                  {state.status !== "resolved" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onCommand({ kind: "resolve" })}
                    >
                      {t("actions.resolve")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onCommand({ kind: "reopen" })}
                    >
                      {t("actions.reopen")}
                    </Button>
                  )}
                </div>
              ) : null}
              {viewer.manages ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-12 text-text-secondary">
                    {t("actions.assign")}
                  </span>
                  <NativeSelect
                    size="sm"
                    value={state.assignee ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      onCommand({
                        kind: "assign",
                        assignee: event.target.value || null,
                      })
                    }
                  >
                    <NativeSelectOption value="">
                      {t("nobody")}
                    </NativeSelectOption>
                    {candidates.map((candidate) => (
                      <NativeSelectOption
                        key={candidate.mxid}
                        value={candidate.mxid}
                      >
                        {candidate.mxid === me ? t("you") : candidate.name}
                      </NativeSelectOption>
                    ))}
                    {state.assignee &&
                    !candidates.some((c) => c.mxid === state.assignee) ? (
                      <NativeSelectOption value={state.assignee} disabled>
                        {assigneeName}
                      </NativeSelectOption>
                    ) : null}
                  </NativeSelect>
                </label>
              ) : null}
            </CardContent>
          </Card>

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
        </div>
      </ScrollArea>
    </aside>
  );
}
