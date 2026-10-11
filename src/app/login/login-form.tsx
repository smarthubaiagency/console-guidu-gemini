"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { ErrorNotice } from "@/shared/ui/auth-shell";
import { Field, SubmitButton } from "@/shared/ui/form";

import { signInWithPassword } from "./actions";

export function LoginForm({ next }: Readonly<{ next: string }>) {
  const t = useTranslations("auth.login");
  const [state, action, pending] = useActionState(
    signInWithPassword,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field
        label={t("email")}
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      <Field
        label={t("password")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {state.error ? <ErrorNotice>{state.error}</ErrorNotice> : null}
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      <p className="text-14">
        <Link href="/forgot-password" className="underline">
          {t("forgotPassword")}
        </Link>
      </p>
    </form>
  );
}
