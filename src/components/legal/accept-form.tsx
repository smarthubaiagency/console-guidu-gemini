"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  acceptLegalDocumentsAction,
  type LegalActionState,
} from "@/core/legal/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const INITIAL: LegalActionState = {};

export function AcceptLegalForm({ next }: Readonly<{ next: string }>) {
  const t = useTranslations("legal.accept");
  const [state, action, pending] = useActionState(
    acceptLegalDocumentsAction,
    INITIAL,
  );
  useActionStatus(state);
  return (
    <form action={action} className="space-y-3" data-testid="accept-legal">
      <input type="hidden" name="next" value={next} />
      <Label className="text-14 text-text items-start font-normal">
        <Checkbox name="agree" required />
        {t("agree")}
      </Label>
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
