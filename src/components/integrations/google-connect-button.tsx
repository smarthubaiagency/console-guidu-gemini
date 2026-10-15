"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import type { PartnerActionState } from "@/core/partners/actions";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

const INITIAL: PartnerActionState = {};

/**
 * "Conectar conta Google" (CF6b): the action checks the role and the app,
 * keeps the PKCE verifier in a cookie and answers Google's consent URL;
 * the browser then leaves for Google. Errors go to the SmartStatusBanner.
 */
export function GoogleConnectButton({
  action,
  workspaceSlug,
  label,
  pendingLabel,
  disabled = false,
}: Readonly<{
  action: Action;
  workspaceSlug: string;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}>) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const left = useRef(false);
  useActionStatus(state === INITIAL || state.redirectTo ? null : state);

  useEffect(() => {
    if (state.success && state.redirectTo && !left.current) {
      left.current = true;
      window.location.assign(state.redirectTo);
    }
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <Button
        type="submit"
        size="sm"
        disabled={pending || disabled || Boolean(state.redirectTo)}
        data-testid="google-connect"
      >
        {pending || state.redirectTo ? pendingLabel : label}
      </Button>
    </form>
  );
}

/**
 * The result of the return from Google (`?google=`), shown once in the
 * SmartStatusBanner when the page opens.
 */
export function GoogleReturnStatus({
  result,
}: Readonly<{ result: { message?: string; error?: string } | null }>) {
  const [stable] = useState(result);
  useActionStatus(stable);
  return null;
}
