"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  revertManagedModePartnerAction,
  revertManagedModePlatformAction,
} from "@/core/service-modes/actions";

const REASON_MIN = 10;
const REASON_MAX = 500;

/**
 * "Devolver ao padrão" (AJ1): the partner (or GUIDU, for a direct
 * customer) ends the managed mode of a company. A confirmation dialog asks
 * the reason, which the owner reads in the notice; the result goes to the
 * SmartStatusBanner (ADR 0016) and a reason error stays next to the field.
 */
export function RevertToStandardButton({
  level,
  organizationId,
  organizationName,
}: Readonly<{
  level: "partner" | "platform";
  organizationId: string;
  organizationName: string;
}>) {
  const t = useTranslations("serviceMode");
  const tCommon = useTranslations("common");
  const { showStatus } = useStatus();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const text = reason.trim();
    if (text.length < REASON_MIN || text.length > REASON_MAX) {
      setError(t("errors.reason"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const action =
        level === "platform"
          ? revertManagedModePlatformAction
          : revertManagedModePartnerAction;
      const result = await action({ organizationId, reason: text });
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
      if (result.message) showStatus({ type: "up", title: result.message });
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="revert-managed-mode"
      >
        <RotateCcw />
        {t("console.revert")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-md"
          data-testid="revert-managed-mode-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {t("console.revertTitle", { organization: organizationName })}
            </DialogTitle>
            <DialogDescription>
              {t("console.revertDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`revert-reason-${organizationId}`}>
              {t("console.revertReason")}
            </Label>
            <Textarea
              id={`revert-reason-${organizationId}`}
              value={reason}
              maxLength={REASON_MAX}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            {error ? (
              <p
                className="text-12 text-danger-text"
                data-testid="revert-reason-error"
              >
                {error}
              </p>
            ) : (
              <p className="text-12 text-text-secondary">
                {t("console.revertReasonHint")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("console.revertCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirm}
              disabled={pending}
              data-testid="revert-managed-mode-confirm"
            >
              {t("console.revertConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
