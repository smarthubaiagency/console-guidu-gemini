"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Field, SubmitButton } from "@/shared/ui/form";

import { requestPasswordRecovery } from "./actions";

export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const [state, action, pending] = useActionState(
    requestPasswordRecovery,
    EMPTY_FORM_STATE,
  );
  useActionStatus(state);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label={t("email")}
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      <p className="text-14">
        <Link href="/login" className="underline">
          {t("backToLogin")}
        </Link>
      </p>
    </form>
  );
}
