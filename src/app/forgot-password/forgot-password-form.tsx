"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { SuccessNotice } from "@/shared/ui/auth-shell";
import { Field, SubmitButton } from "@/shared/ui/form";

import { requestPasswordRecovery } from "./actions";

export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const [state, action, pending] = useActionState(
    requestPasswordRecovery,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label={t("email")}
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      {state.message ? <SuccessNotice>{state.message}</SuccessNotice> : null}
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      <p className="text-14">
        <Link href="/login" className="underline">
          {t("backToLogin")}
        </Link>
      </p>
    </form>
  );
}
