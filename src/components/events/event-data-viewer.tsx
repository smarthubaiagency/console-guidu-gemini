"use client";

import { Eye, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { viewEventDataAction } from "@/core/events/actions";

const MIN = 10;
const MAX = 500;

/**
 * "Ver dados" of an event (H1, keychain): asks the reason, opens the data
 * through the server (MFA, capability and audit there) and shows it here.
 * The result goes to the SmartStatusBanner (ADR 0016); a reason too short
 * is a field error, next to the field.
 */
export function EventDataViewer({ eventId }: Readonly<{ eventId: string }>) {
  const t = useTranslations("events.keychain");
  const tErrors = useTranslations("events.errors");
  const tCommon = useTranslations("common");
  const { showStatus } = useStatus();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < MIN || trimmed.length > MAX) {
      setFieldError(tErrors("reason", { min: MIN, max: MAX }));
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      const result = await viewEventDataAction({ eventId, reason: trimmed });
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
        return;
      }
      setData(result.data ?? null);
      setOpen(false);
      setReason("");
      if (result.message) showStatus({ type: "up", title: result.message });
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="event-keychain">
      {data ? (
        <div className="flex flex-col gap-2">
          <p className="text-12 text-text-secondary font-medium">{t("data")}</p>
          <pre
            className="bg-surface-inset rounded-inner text-12 text-text max-h-96 overflow-auto p-3 font-mono break-all whitespace-pre-wrap"
            data-testid="event-data"
          >
            {data}
          </pre>
        </div>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-2">
          <p className="text-12 text-text-secondary">{t("description")}</p>
          <Label htmlFor={`event-reason-${eventId}`} className="text-12">
            {t("reason")}
          </Label>
          <Textarea
            id={`event-reason-${eventId}`}
            value={reason}
            maxLength={MAX}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={`event-reason-hint-${eventId}`}
            onChange={(e) => setReason(e.target.value)}
          />
          <p
            id={`event-reason-hint-${eventId}`}
            className={
              fieldError
                ? "text-12 text-danger-text"
                : "text-11 text-text-secondary"
            }
            data-testid="event-reason-hint"
          >
            {fieldError ?? t("reasonHint", { min: MIN, max: MAX })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={submit} disabled={pending}>
              <Eye />
              {t("submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setFieldError(null);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <KeyRound />
            {t("title")}
          </Button>
        </div>
      )}
    </div>
  );
}
