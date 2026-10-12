"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";

import { acceptInvitationAction } from "./actions";
import { Button } from "@/components/ui/button";

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
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? t("accepting") : t("accept")}
      </Button>
    </form>
  );
}
