"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { ErrorNotice } from "@/shared/ui/auth-shell";
import { Field, SubmitButton } from "@/shared/ui/form";

import { completePasswordReset } from "./actions";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(
    completePasswordReset,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="Nova senha"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="Pelo menos 12 caracteres."
      />
      <Field
        label="Confirme a nova senha"
        name="confirmation"
        type="password"
        autoComplete="new-password"
        required
      />
      {state.error ? <ErrorNotice>{state.error}</ErrorNotice> : null}
      <SubmitButton pending={pending}>Salvar nova senha</SubmitButton>
    </form>
  );
}
