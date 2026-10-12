"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, type ReactNode } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
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
        <Button
          type="submit"
          size="sm"
          variant={tone === "primary" ? "default" : "outline"}
          disabled={pending || disabled}
        >
          {pending ? t("saving") : submitLabel}
        </Button>
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
