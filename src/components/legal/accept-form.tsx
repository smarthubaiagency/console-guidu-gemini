"use client";

import { useActionState } from "react";

import {
  acceptLegalDocumentsAction,
  type LegalActionState,
} from "@/core/legal/actions";

const INITIAL: LegalActionState = {};

export function AcceptLegalForm({ next }: Readonly<{ next: string }>) {
  const [state, action, pending] = useActionState(
    acceptLegalDocumentsAction,
    INITIAL,
  );
  return (
    <form action={action} className="space-y-3" data-testid="accept-legal">
      <input type="hidden" name="next" value={next} />
      <label className="text-14 text-text flex items-start gap-2">
        <input type="checkbox" name="agree" required className="mt-1" />
        Li e aceito os documentos acima.
      </label>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-on-primary text-14 rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
      >
        {pending ? "Registrando..." : "Aceitar e continuar"}
      </button>
      {state.error ? (
        <p role="alert" className="text-12 text-danger-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
