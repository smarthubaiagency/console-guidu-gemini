"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ConversationStatus } from "../views";
import { PanelSection } from "./panel-section";
import { StatusBadge } from "./status-badge";
import type { ConversationCommand } from "./types";

/** Value of "nobody" in the selects (Radix Select has no empty value). */
const NONE = "__none";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : name;
  return letters.slice(0, 2).toUpperCase();
}

function Person({ name }: Readonly<{ name: string }>) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-6 rounded-full">
        <AvatarFallback className="text-11 rounded-full">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate" data-testid="inbox-assignee">
        {name}
      </span>
    </span>
  );
}

function Field({
  label,
  action,
  children,
}: Readonly<{
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-14 text-text font-medium">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * "Ações da conversa" (IN4c), the old "Atendimento" card: the status with
 * resolve or reopen, the assigned agent with "Atribuir a mim" (who answers
 * takes the conversation) and the select of who manages the Inbox, plus
 * team and priority, which only hold their place for now. The labels keep
 * a section of their own.
 */
export function ActionsSection({
  status,
  assignee,
  assigneeName,
  candidates,
  me,
  answers,
  manages,
  busy,
  onCommand,
}: Readonly<{
  status: ConversationStatus;
  assignee: string | null;
  assigneeName: string;
  candidates: readonly { mxid: string; name: string }[];
  me: string | null;
  answers: boolean;
  manages: boolean;
  busy: boolean;
  onCommand: (command: ConversationCommand) => void;
}>) {
  const t = useTranslations("inbox");
  const canTake = answers && status !== "resolved" && assignee !== me;
  const unknown =
    assignee !== null && !candidates.some((c) => c.mxid === assignee);

  return (
    <PanelSection
      value="actions"
      title={t("actions.title")}
      testId="inbox-actions"
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-14 text-text font-medium">
          {t("context.status")}
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={status} />
          {answers ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                onCommand({
                  kind: status === "resolved" ? "reopen" : "resolve",
                })
              }
            >
              {status === "resolved"
                ? t("actions.reopen")
                : t("actions.resolve")}
            </Button>
          ) : null}
        </span>
      </div>

      <Field
        label={t("actions.assignee")}
        action={
          canTake ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={busy}
              onClick={() => onCommand({ kind: "take" })}
            >
              <ArrowRight />
              {t("actions.assignToMe")}
            </Button>
          ) : null
        }
      >
        <Select
          value={assignee ?? NONE}
          disabled={busy || !manages}
          onValueChange={(value) =>
            onCommand({
              kind: "assign",
              assignee: value === NONE ? null : value,
            })
          }
        >
          <SelectTrigger
            className="h-10 w-full"
            aria-label={t("actions.assignee")}
          >
            <SelectValue>
              {assignee === null ? (
                <span className="truncate" data-testid="inbox-assignee">
                  {assigneeName}
                </span>
              ) : (
                <Person name={assigneeName} />
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("nobody")}</SelectItem>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.mxid} value={candidate.mxid}>
                {candidate.mxid === me ? t("you") : candidate.name}
              </SelectItem>
            ))}
            {unknown && assignee ? (
              <SelectItem value={assignee} disabled>
                {assigneeName}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("actions.team")}>
        <Select value={NONE} disabled>
          <SelectTrigger
            className="h-10 w-full"
            aria-label={t("actions.team")}
            title={t("actions.soon")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("actions.noTeam")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("actions.priority")}>
        <Select value={NONE} disabled>
          <SelectTrigger
            className="h-10 w-full"
            aria-label={t("actions.priority")}
            title={t("actions.soon")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("actions.noPriority")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </PanelSection>
  );
}
