"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { Switch } from "@/components/ui/switch";
import { setKeychainAction } from "@/core/events/actions";

/**
 * The platform owner grants or removes full access (`keychain`) of a team
 * member (H1); saves on change and answers in the SmartStatusBanner.
 */
export function KeychainSwitch({
  userId,
  enabled,
  label,
}: Readonly<{ userId: string; enabled: boolean; label: string }>) {
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { showStatus } = useStatus();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState(enabled);

  function onChange(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const result = await setKeychainAction({ userId, enabled: next });
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
      data-testid={`keychain-${userId}`}
    />
  );
}
