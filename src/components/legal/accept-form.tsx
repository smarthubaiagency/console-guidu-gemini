"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  acceptLegalDocumentsAction,
  type LegalActionState,
} from "@/core/legal/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";

const INITIAL: LegalActionState = {};

export function AcceptLegalForm({ next }: Readonly<{ next: string }>) {
  const t = useTranslations("legal.accept");
  const [state, action, pending] = useActionState(
    acceptLegalDocumentsAction,
    INITIAL,
  );
  useActionStatus(state);
  return (
    <form action={action} className="space-y-3" data-testid="accept-legal">
      <input type="hidden" name="next" value={next} />
      <label className="text-14 text-text flex items-start gap-2">
        <input type="checkbox" name="agree" required className="mt-1" />
        {t("agree")}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-on-primary text-14 rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
