"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";

import { acceptInvitationAction } from "./actions";

export function InviteForm({ rawToken }: Readonly<{ rawToken: string }>) {
  const t = useTranslations("invite.team.valid");
  const [isPending, startTransition] = useTransition();
  const { showStatus } = useStatus();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await acceptInvitationAction(rawToken);
      if (result?.error) {
        showStatus({ type: "down", title: result.error });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <button
        type="submit"
        disabled={isPending}
        className="bg-primary text-on-primary hover:bg-primary-hover focus:outline-focus-ring text-14 flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition disabled:opacity-50"
      >
        {isPending ? t("accepting") : t("accept")}
      </button>
    </form>
  );
}
