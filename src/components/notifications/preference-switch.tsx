"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { Switch } from "@/components/ui/switch";
import { saveNotificationPreferenceAction } from "@/core/notifications/actions";

/**
 * One cell of the preference matrix (CF3c) for an optional event: saves on
 * change and answers in the SmartStatusBanner (ADR 0016). The label comes
 * from the server, keeping `notificationCenter` out of the client messages.
 */
export function PreferenceSwitch({
  eventType,
  channel,
  enabled,
  label,
}: Readonly<{
  eventType: string;
  channel: string;
  enabled: boolean;
  label: string;
}>) {
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { showStatus } = useStatus();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState(enabled);

  function onChange(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const result = await saveNotificationPreferenceAction({
        eventType,
        channel,
        enabled: next,
      });
      if (result.error) {
        setChecked(!next);
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
        return;
      }
      if (result.message) showStatus({ type: "up", title: result.message });
      router.refresh();
    });
  }

  return (
    <Switch
      checked={checked}
      disabled={pending}
      onCheckedChange={onChange}
      aria-label={label}
      data-testid={`preference-${eventType}-${channel}`}
    />
  );
}
