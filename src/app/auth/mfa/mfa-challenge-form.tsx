"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { ErrorNotice } from "@/shared/ui/auth-shell";
import { Field, SubmitButton } from "@/shared/ui/form";

import { verifyMfaChallenge } from "./actions";

export function MfaChallengeForm({
  factorId,
  next,
}: Readonly<{ factorId: string; next: string }>) {
  const [state, action, pending] = useActionState(
    verifyMfaChallenge,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <Field
        label="Código do aplicativo autenticador"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
      />
      {state.error ? <ErrorNotice>{state.error}</ErrorNotice> : null}
      <SubmitButton pending={pending}>Confirmar</SubmitButton>
    </form>
  );
}
