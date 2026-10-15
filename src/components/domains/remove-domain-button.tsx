"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import {
  removePartnerDomainAction,
  removePartnerPublicDomainAction,
  removeWorkspaceDomainAction,
} from "@/core/domains/actions";

const ACTIONS = {
  partner: removePartnerDomainAction,
  workspace: removeWorkspaceDomainAction,
  // Default domain of the partner's customers (CF2c).
  base: removePartnerPublicDomainAction,
} as const;

export type RemoveDomainLabels = Readonly<{
  remove: string;
  title: string;
  message: string;
  cancel: string;
}>;

/**
 * Removes a domain after a confirmation in the banner (CF2b). The result goes
 * straight to the banner: the row, and this button, leave the page in the
 * same revalidation, so a form state hook would never announce it. Labels
 * come from the server list, keeping `domains` out of the client messages.
 */
export function RemoveDomainButton({
  kind,
  fields,
  labels,
}: Readonly<{
  kind: keyof typeof ACTIONS;
  /** Form fields the action reads (host or domainId, workspace slug). */
  fields: Readonly<Record<string, string>>;
  labels: RemoveDomainLabels;
}>) {
  const tCommon = useTranslations("common");
  const { confirmStatus, showStatus } = useStatus();
  const [pending, startTransition] = useTransition();

  async function onRemove() {
    const confirmed = await confirmStatus({
      title: labels.title,
      message: labels.message,
      confirmLabel: labels.remove,
      cancelLabel: labels.cancel,
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      for (const [name, value] of Object.entries(fields)) {
        formData.append(name, value);
      }
      const result = await ACTIONS[kind]({}, formData);
      if (result.error) {
        showStatus({
          type: "down",
          title: result.error,
          ...(result.requestId
            ? {
                message: tCommon("reference", {
                  id: result.requestId.slice(0, 8),
                }),
              }
            : {}),
        });
      } else if (result.message) {
        showStatus({ type: "up", title: result.message });
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onRemove}
      data-testid="domain-remove"
    >
      <Trash2 />
      {labels.remove}
    </Button>
  );
}
