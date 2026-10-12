"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Field, SubmitButton } from "@/shared/ui/form";

import { verifyMfaChallenge } from "./actions";

export function MfaChallengeForm({
  factorId,
  next,
}: Readonly<{ factorId: string; next: string }>) {
  const t = useTranslations("auth.mfa");
  const [state, action, pending] = useActionState(
    verifyMfaChallenge,
    EMPTY_FORM_STATE,
  );
  useActionStatus(state);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <Field
        label={t("code")}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
      />
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
    </form>
  );
}
