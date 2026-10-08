"use client";

import Link from "next/link";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { SuccessNotice } from "@/shared/ui/auth-shell";
import { Field, SubmitButton } from "@/shared/ui/form";

import { requestPasswordRecovery } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    requestPasswordRecovery,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="E-mail"
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      {state.message ? <SuccessNotice>{state.message}</SuccessNotice> : null}
      <SubmitButton pending={pending}>Enviar link de recuperação</SubmitButton>
      <p className="text-14">
        <Link href="/login" className="underline">
          Voltar para entrar
        </Link>
      </p>
    </form>
  );
}
