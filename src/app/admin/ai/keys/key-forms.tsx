"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  type AiConsoleActionState,
  registerPartnerKeyAction,
  revokePartnerKeyAction,
} from "@/core/ai/console-actions";

const INITIAL: AiConsoleActionState = {};
const PURPOSES = ["all", "chat", "embeddings"] as const;

/** A new admin key in the partner's vault. */
export function RegisterKeyForm({
  providers,
}: Readonly<{ providers: readonly string[] }>) {
  const t = useTranslations("aiConsole");
  const [state, action, pending] = useActionState(
    registerPartnerKeyAction,
    INITIAL,
  );
  useActionStatus(state);
  return (
    <form action={action} className="space-y-3" data-testid="register-key">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="key-provider" className="text-12">
            {t("keys.form.provider")}
          </Label>
          <NativeSelect
            id="key-provider"
            name="provider"
            className="w-full"
            required
          >
            {providers.map((id) => (
              <NativeSelectOption key={id} value={id}>
                {t(`providers.${id}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="key-purpose" className="text-12">
            {t("keys.form.purpose")}
          </Label>
          <NativeSelect id="key-purpose" name="purpose" className="w-full">
            {PURPOSES.map((purpose) => (
              <NativeSelectOption key={purpose} value={purpose}>
                {t(`keys.purpose.${purpose}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="key-label" className="text-12">
            {t("keys.form.label")}
          </Label>
          <Input id="key-label" name="label" required maxLength={120} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="key-secret" className="text-12">
          {t("keys.form.secret")}
        </Label>
        <Input
          id="key-secret"
          name="secret"
          type="password"
          autoComplete="off"
          required
          maxLength={500}
        />
        <p className="text-11 text-text-secondary">{t("keys.form.hint")}</p>
      </div>
      <Button type="submit" disabled={pending}>
        {t("keys.form.save")}
      </Button>
    </form>
  );
}

export function RevokeKeyButton({
  credentialId,
  label,
}: Readonly<{ credentialId: string; label: string }>) {
  const t = useTranslations("aiConsole.keys");
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  const [state, setState] = useState<AiConsoleActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);

  async function onRevoke() {
    const confirmed = await confirmStatus({
      title: t("revokeTitle"),
      message: t("revokeMessage", { label }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("revoke"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("credentialId", credentialId);
      setState(await revokePartnerKeyAction({}, formData));
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onRevoke}
    >
      {t("revoke")}
    </Button>
  );
}
