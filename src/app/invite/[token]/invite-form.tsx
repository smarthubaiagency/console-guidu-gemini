"use client";

import { useState, useTransition } from "react";
import { ErrorNotice } from "@/shared/ui/auth-shell";
import { acceptInvitationAction, type AcceptInvitationState } from "./actions";

export function InviteForm({ rawToken }: Readonly<{ rawToken: string }>) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<AcceptInvitationState | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await acceptInvitationAction(rawToken);
      if (result?.error) {
        setState(result);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {state?.error && (
        <ErrorNotice testId="invite-error">{state.error}</ErrorNotice>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-primary text-on-primary hover:bg-primary-hover focus:outline-focus-ring flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-14 font-medium transition disabled:opacity-50"
      >
        {isPending ? "Aceitando convite..." : "Aceitar Convite"}
      </button>
    </form>
  );
}
