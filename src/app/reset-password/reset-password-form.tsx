"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { ErrorNotice } from "@/shared/ui/auth-shell";
import { Field, SubmitButton } from "@/shared/ui/form";

import { completePasswordReset } from "./actions";

export function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const [state, action, pending] = useActionState(
    completePasswordReset,
    EMPTY_FORM_STATE,
  );

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
      {state.error ? <ErrorNotice>{state.error}</ErrorNotice> : null}
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
    </form>
  );
}
