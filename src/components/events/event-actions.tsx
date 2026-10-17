"use client";

import { Check, Eye, KeyRound, RotateCcw, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  decideEventAccessAction,
  readEventDataByGrantAction,
  requestEventAccessAction,
  revokeEventAccessAction,
  setConsoleEventStatusAction,
  setWorkspaceEventStatusAction,
  withdrawEventAccessAction,
} from "@/core/events/h2-actions";

/**
 * Client pieces of the Eventos screens (H2): change an event's status, ask
 * for access to its data, read it with an approved grant, and the
 * customer's decision. Every result goes to the SmartStatusBanner (ADR
 * 0016); a field error stays next to its field.
 */

type Result = Readonly<{
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  data?: string;
}>;

function useAnnounce() {
  const tCommon = useTranslations("common");
  const { showStatus } = useStatus();
  const router = useRouter();
  return (result: Result, refresh = true): boolean => {
    if (result.error) {
      showStatus({
        type: "down",
        title: result.error,
        ...(result.requestId
          ? {
              message: tCommon("reference", {
                id: result.requestId.slice(0, 8),
              }),
            }
          : {}),
      });
      return false;
    }
    if (result.message) showStatus({ type: "up", title: result.message });
    if (refresh) router.refresh();
    return true;
  };
}

export type EventScope =
  | Readonly<{ level: "workspace"; workspaceSlug: string }>
  | Readonly<{ level: "platform" | "partner" }>;

export function EventStatusButtons({
  scope,
  eventId,
  status,
}: Readonly<{ scope: EventScope; eventId: string; status: string }>) {
  const t = useTranslations("eventRules.events");
  const announce = useAnnounce();
  const [pending, startTransition] = useTransition();
  function set(next: "open" | "resolved" | "dismissed") {
    startTransition(async () => {
      const result =
        scope.level === "workspace"
          ? await setWorkspaceEventStatusAction({
              workspaceSlug: scope.workspaceSlug,
              eventId,
              status: next,
            })
          : await setConsoleEventStatusAction({
              level: scope.level,
              eventId,
              status: next,
            });
      announce(result);
    });
  }
  if (!["open", "resolved", "dismissed"].includes(status)) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="event-status-actions">
      {status === "open" ? (
        <>
          <Button size="sm" onClick={() => set("resolved")} disabled={pending}>
            <Check />
            {t("resolve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => set("dismissed")}
            disabled={pending}
          >
            <X />
            {t("dismiss")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => set("open")}
          disabled={pending}
        >
          <RotateCcw />
          {t("reopen")}
        </Button>
      )}
    </div>
  );
}

const HOURS = [24, 48, 72, 96, 120, 144, 168] as const;

/**
 * The access request: reason, reference and term (24 h to 7 days, 72 h by
 * default) for one event (the drawer) or several events of the same
 * workspace (the list's selection, AJ1, `startOpen` inside its dialog).
 */
export function AccessRequestForm({
  level,
  eventIds,
  startOpen = false,
  onDone,
}: Readonly<{
  level: "platform" | "partner";
  eventIds: readonly string[];
  startOpen?: boolean;
  /** After a sent request, or a cancel when it started open. */
  onDone?: (sent: boolean) => void;
}>) {
  const t = useTranslations("eventRules.access");
  const announce = useAnnounce();
  const [open, setOpen] = useState(startOpen);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [hours, setHours] = useState("72");
  const [errors, setErrors] = useState<{ reason?: string; reference?: string }>(
    {},
  );
  const [pending, startTransition] = useTransition();
  const idBase = `${eventIds[0] ?? "events"}-${eventIds.length}`;
  const many = eventIds.length > 1;

  function close(sent: boolean) {
    if (!startOpen) setOpen(false);
    onDone?.(sent);
  }

  function submit() {
    const next: { reason?: string; reference?: string } = {};
    if (reason.trim().length < 10 || reason.trim().length > 500) {
      next.reason = t("reasonError");
    }
    if (!reference.trim() || reference.trim().length > 120) {
      next.reference = t("referenceError");
    }
    setErrors(next);
    if (next.reason || next.reference) return;
    startTransition(async () => {
      const result = await requestEventAccessAction({
        level,
        eventIds: [...eventIds],
        reason: reason.trim(),
        reference: reference.trim(),
        hours: Number(hours),
      });
      if (announce(result)) {
        setReason("");
        setReference("");
        close(true);
      }
    });
  }

  if (!open) {
    return (
      <div data-testid="access-request">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <KeyRound />
          {t("request")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="access-request">
      <p className="text-12 text-text-secondary">
        {many ? t("requestManyHint") : t("requestHint")}
      </p>
      <Label htmlFor={`access-reason-${idBase}`} className="text-12">
        {t("reason")}
      </Label>
      <Textarea
        id={`access-reason-${idBase}`}
        value={reason}
        maxLength={500}
        aria-invalid={errors.reason ? true : undefined}
        onChange={(e) => setReason(e.target.value)}
      />
      {errors.reason ? (
        <p
          className="text-12 text-danger-text"
          data-testid="access-reason-error"
        >
          {errors.reason}
        </p>
      ) : null}
      <Label htmlFor={`access-reference-${idBase}`} className="text-12">
        {t("reference")}
      </Label>
      <Input
        id={`access-reference-${idBase}`}
        value={reference}
        maxLength={120}
        aria-invalid={errors.reference ? true : undefined}
        onChange={(e) => setReference(e.target.value)}
      />
      {errors.reference ? (
        <p className="text-12 text-danger-text">{errors.reference}</p>
      ) : null}
      <Label htmlFor={`access-hours-${idBase}`} className="text-12">
        {t("duration")}
      </Label>
      <NativeSelect
        id={`access-hours-${idBase}`}
        value={hours}
        onChange={(e) => setHours(e.target.value)}
      >
        {HOURS.map((value) => (
          <NativeSelectOption key={value} value={String(value)}>
            {t("hours", { hours: value })}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={submit} disabled={pending}>
          <Send />
          {t("send")}
        </Button>
        <Button type="button" variant="outline" onClick={() => close(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

export function GrantDataViewer({
  level,
  eventId,
  grantId,
}: Readonly<{
  level: "platform" | "partner";
  eventId: string;
  grantId: string;
}>) {
  const t = useTranslations("eventRules.access");
  const announce = useAnnounce();
  const [data, setData] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2" data-testid="grant-data">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            startTransition(async () => {
              const result = await readEventDataByGrantAction({
                level,
                eventId,
              });
              if (announce(result, false)) setData(result.data ?? null);
            })
          }
          disabled={pending}
        >
          <Eye />
          {t("viewData")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            startTransition(async () => {
              announce(await withdrawEventAccessAction({ level, grantId }));
            })
          }
          disabled={pending}
        >
          {t("endAccess")}
        </Button>
      </div>
      {data ? (
        <pre
          className="bg-surface-inset rounded-inner text-12 text-text max-h-96 overflow-auto p-3 font-mono break-all whitespace-pre-wrap"
          data-testid="grant-event-data"
        >
          {data}
        </pre>
      ) : null}
    </div>
  );
}

export function AccessDecision({
  workspaceSlug,
  grantId,
  status,
  maxHours,
}: Readonly<{
  workspaceSlug: string;
  grantId: string;
  status: string;
  maxHours: number;
}>) {
  const t = useTranslations("eventRules.access");
  const announce = useAnnounce();
  const [hours, setHours] = useState(String(maxHours));
  const [pending, startTransition] = useTransition();
  if (status === "approved") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        data-testid="access-revoke"
        onClick={() =>
          startTransition(async () => {
            announce(await revokeEventAccessAction({ workspaceSlug, grantId }));
          })
        }
      >
        {t("revoke")}
      </Button>
    );
  }
  if (status !== "pending") return null;
  return (
    <div
      className="flex flex-wrap items-end gap-2"
      data-testid="access-decision"
    >
      <div className="space-y-1">
        <Label htmlFor={`grant-hours-${grantId}`} className="text-12">
          {t("duration")}
        </Label>
        <NativeSelect
          id={`grant-hours-${grantId}`}
          value={hours}
          size="sm"
          onChange={(e) => setHours(e.target.value)}
        >
          {HOURS.filter((value) => value <= maxHours).map((value) => (
            <NativeSelectOption key={value} value={String(value)}>
              {t("hours", { hours: value })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            announce(
              await decideEventAccessAction({
                workspaceSlug,
                grantId,
                decision: "approve",
                hours: Number(hours),
              }),
            );
          })
        }
      >
        <Check />
        {t("approve")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            announce(
              await decideEventAccessAction({
                workspaceSlug,
                grantId,
                decision: "deny",
              }),
            );
          })
        }
      >
        <X />
        {t("deny")}
      </Button>
    </div>
  );
}
