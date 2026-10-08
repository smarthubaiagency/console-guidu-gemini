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
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
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
      <div className="rounded-md border border-neutral-300 p-3 text-sm">
        <p className="font-medium">Chave para o aplicativo autenticador</p>
        <p className="text-muted-foreground mt-1">
          Cadastre esta chave e informe o código gerado.
        </p>
        <code
          data-testid="totp-secret"
          className="mt-2 block font-mono text-xs break-all"
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
