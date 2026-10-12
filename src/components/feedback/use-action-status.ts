"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { useStatus } from "./status-context";

/** Result shape shared by the server actions of the dashboard. */
export type ActionResult = Readonly<{
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
}>;

/**
 * Shows the result of a server action in the SmartStatusBanner (ADR 0016):
 * an error as `down`, with the request reference for support, and a success
 * message as `up`. Each result object is announced once: a revalidation
 * re-renders the translations (`t` changes), and without the guard every
 * mounted form would repeat its old message over the new one.
 */
export function useActionStatus(state: ActionResult | null | undefined) {
  const t = useTranslations("common");
  const { showStatus } = useStatus();
  const announced = useRef<ActionResult | null>(null);

  useEffect(() => {
    if (!state || announced.current === state) return;
    announced.current = state;
    if (state.error) {
      showStatus({
        type: "down",
        title: state.error,
        ...(state.requestId
          ? { message: t("reference", { id: state.requestId.slice(0, 8) }) }
          : {}),
      });
    } else if (state.message) {
      showStatus({ type: "up", title: state.message });
    } else if (state.success) {
      showStatus({ type: "up", title: t("saved") });
    }
  }, [state, showStatus, t]);
}
