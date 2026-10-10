"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, type ReactNode } from "react";

import type { PartnerActionState } from "@/core/partners/actions";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

const INITIAL: PartnerActionState = {};

/**
 * Small form around a partner server action: shows the result, the generated
 * invitation link and follows `redirectTo` after success.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className = "flex flex-wrap items-end gap-2",
  testId,
  tone = "primary",
}: Readonly<{
  action: Action;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  testId?: string;
  tone?: "primary" | "neutral";
}>) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, INITIAL);

  useEffect(() => {
    if (state.success && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  return (
    <div className="space-y-2" data-testid={testId}>
      <form action={formAction} className={className}>
        {children}
        <button
          type="submit"
          disabled={pending}
          className={
            tone === "primary"
              ? "bg-primary text-on-primary text-12 rounded-lg px-3 py-2 font-semibold disabled:opacity-60"
              : "border-border text-text-subtle hover:bg-surface-hover text-12 rounded-lg border px-3 py-2 font-semibold disabled:opacity-60"
          }
        >
          {pending ? "Salvando..." : submitLabel}
        </button>
      </form>
      {state.error ? (
        <p role="alert" className="text-12 text-danger-text">
          {state.error}
          {state.requestId ? ` (ref. ${state.requestId.slice(0, 8)})` : ""}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="text-12 text-success-text">
          {state.message}
        </p>
      ) : null}
      {state.inviteUrl ? (
        <p className="text-12 text-text-subtle">
          Link do convite (válido por 72 horas):{" "}
          <code
            className="bg-surface-raised text-11 rounded-sm px-1.5 py-0.5 break-all"
            data-testid="partner-invite-url"
          >
            {state.inviteUrl}
          </code>
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "border-border bg-surface-input text-14 text-text rounded-lg border px-3 py-2";
export const labelClass =
  "text-12 text-text-subtle flex flex-col gap-1 font-medium";
