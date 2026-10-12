"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Field, SubmitButton } from "@/shared/ui/form";

import { completePasswordReset } from "./actions";

export function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const [state, action, pending] = useActionState(
    completePasswordReset,
    EMPTY_FORM_STATE,
  );
  useActionStatus(state);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label={t("password")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint={t("passwordHint")}
      />
      <Field
        label={t("confirmation")}
        name="confirmation"
        type="password"
        autoComplete="new-password"
        required
      />
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
    </form>
  );
}
