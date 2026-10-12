"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, type ReactNode } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import type { PartnerActionState } from "@/core/partners/actions";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

const INITIAL: PartnerActionState = {};

/**
 * Small form around a server action: the result goes to the SmartStatusBanner
 * (ADR 0016), the generated invitation link stays below the form (it is
 * content to copy, not a message) and `redirectTo` is followed on success.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className = "flex flex-wrap items-end gap-2",
  testId,
  tone = "primary",
  disabled = false,
}: Readonly<{
  action: Action;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  testId?: string;
  tone?: "primary" | "neutral";
  /** Submit button disabled (e.g. a feature not configured). */
  disabled?: boolean;
}>) {
  const t = useTranslations("common");
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  useActionStatus(state === INITIAL ? null : state);

  useEffect(() => {
    if (state.success && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  return (
    <div className="space-y-2" data-testid={testId}>
      <form action={formAction} className={className}>
        {children}
        <button
          type="submit"
          disabled={pending || disabled}
          className={
            tone === "primary"
              ? "bg-primary text-on-primary text-12 rounded-lg px-3 py-2 font-semibold disabled:opacity-60"
              : "border-border text-text-subtle hover:bg-surface-hover text-12 rounded-lg border px-3 py-2 font-semibold disabled:opacity-60"
          }
        >
          {pending ? t("saving") : submitLabel}
        </button>
      </form>
      {state.inviteUrl ? (
        <p className="text-12 text-text-subtle">
          {t("inviteLink")}{" "}
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
