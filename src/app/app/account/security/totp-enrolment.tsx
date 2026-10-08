"use client";

import { useActionState, useState, useTransition } from "react";

import { ErrorNotice, SuccessNotice } from "@/shared/ui/auth-shell";
import { Field, SubmitButton } from "@/shared/ui/form";

import { confirmTotpEnrolment, startTotpEnrolment } from "./actions";
import { EMPTY_ENROLMENT, type EnrolmentState } from "./enrolment-state";

export function TotpEnrolment() {
  const [started, setStarted] = useState<EnrolmentState | null>(null);
  const [starting, startEnrolment] = useTransition();
  const [state, action, pending] = useActionState(
    confirmTotpEnrolment,
    EMPTY_ENROLMENT,
  );

  const factorId = state.factorId ?? started?.factorId;
  const secret = state.secret ?? started?.secret;
  const error = state.error ?? started?.error;

  if (state.message) {
    return <SuccessNotice testId="mfa-enrolled">{state.message}</SuccessNotice>;
  }

  if (!factorId) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          data-testid="start-mfa-enrolment"
          disabled={starting}
          onClick={() =>
            startEnrolment(async () => setStarted(await startTotpEnrolment()))
          }
          className="bg-primary text-14 text-on-primary rounded-md px-3 py-2 font-medium disabled:opacity-60"
        >
          Ativar verificação em duas etapas
        </button>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="factorId" value={factorId} />
      <div className="border-border-strong text-14 rounded-md border p-3">
        <p className="font-medium">Chave para o aplicativo autenticador</p>
        <p className="text-text-secondary mt-1">
          Cadastre esta chave e informe o código gerado.
        </p>
        <code
          data-testid="totp-secret"
          className="text-12 mt-2 block font-mono break-all"
        >
          {secret}
        </code>
      </div>
      <Field
        label="Código de seis dígitos"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
      />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <SubmitButton pending={pending}>Confirmar ativação</SubmitButton>
    </form>
  );
}
