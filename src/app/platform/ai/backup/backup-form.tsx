"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  type AiConsoleActionState,
  saveBackupAction,
} from "@/core/ai/console-actions";

const INITIAL: AiConsoleActionState = {};

/**
 * Backup key and model. An empty key keeps the saved one; a new key needs
 * its provider; "Remover a chave" turns the backup off.
 */
export function BackupForm({
  providers,
  provider,
  model,
  hasKey,
}: Readonly<{
  providers: readonly string[];
  provider: string | null;
  model: string | null;
  hasKey: boolean;
}>) {
  const t = useTranslations("aiConsole");
  const [state, action, pending] = useActionState(saveBackupAction, INITIAL);
  useActionStatus(state);
  return (
    <form action={action} className="space-y-3" data-testid="backup-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="backup-provider" className="text-12">
            {t("backup.form.provider")}
          </Label>
          <NativeSelect
            id="backup-provider"
            name="provider"
            className="w-full"
            defaultValue={provider ?? ""}
          >
            <NativeSelectOption value="">
              {t("editor.choose")}
            </NativeSelectOption>
            {providers.map((id) => (
              <NativeSelectOption key={id} value={id}>
                {t(`providers.${id}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="backup-model" className="text-12">
            {t("backup.form.model")}
          </Label>
          <Input
            id="backup-model"
            name="model"
            maxLength={200}
            defaultValue={model ?? ""}
            placeholder={t("backup.form.modelPlaceholder")}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="backup-secret" className="text-12">
          {hasKey ? t("backup.form.replaceKey") : t("backup.form.key")}
        </Label>
        <Input
          id="backup-secret"
          name="secret"
          type="password"
          autoComplete="off"
          maxLength={500}
        />
        <p className="text-11 text-text-secondary">
          {t("backup.form.keyHint")}
        </p>
      </div>
      {hasKey ? (
        <Label className="text-12 font-normal">
          <Checkbox name="clearKey" />
          {t("backup.form.clearKey")}
        </Label>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t("backup.form.save")}
      </Button>
    </form>
  );
}
