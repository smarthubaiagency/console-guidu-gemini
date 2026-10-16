"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkPresentedDataAction } from "@/core/events/actions";

/**
 * Checks data a customer presents against the event's seal (H1): the
 * server recomputes the HMAC with the situation the platform sees and the
 * pasted data, never opening the event's data. The answer goes to the
 * SmartStatusBanner (ADR 0016).
 */
export function PresentedDataCheck({ eventId }: Readonly<{ eventId: string }>) {
  const t = useTranslations("events.check");
  const tCommon = useTranslations("common");
  const { showStatus } = useStatus();
  const [json, setJson] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await checkPresentedDataAction({ eventId, json });
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
      showStatus({
        type: result.seal === "ok" ? "up" : "oops",
        title: result.message ?? "",
      });
    });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="event-check">
      <p className="text-12 text-text-secondary">{t("description")}</p>
      <Label htmlFor={`event-check-${eventId}`} className="text-12">
        {t("label")}
      </Label>
      <Textarea
        id={`event-check-${eventId}`}
        value={json}
        maxLength={20_000}
        className="font-mono"
        onChange={(e) => setJson(e.target.value)}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={submit}
          disabled={pending || json.trim().length === 0}
        >
          <ShieldCheck />
          {t("submit")}
        </Button>
      </div>
    </div>
  );
}
