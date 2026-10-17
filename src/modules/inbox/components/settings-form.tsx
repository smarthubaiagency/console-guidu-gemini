"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import {
  type InboxSettingsState,
  saveInboxSettingsAction,
} from "../guids-actions";
import { INBOX_SERVICE_FIELDS, type InboxServiceSettings } from "../settings";

const INITIAL: InboxSettingsState = {};

export function InboxSettingsForm({
  workspaceSlug,
  canWrite,
  agentId,
  choices,
  service,
}: Readonly<{
  workspaceSlug: string;
  canWrite: boolean;
  agentId: string | null;
  choices: readonly { id: string; name: string; active: boolean }[];
  service: InboxServiceSettings;
}>) {
  const t = useTranslations("inboxGuids.settings");
  const [state, action, pending] = useActionState(
    saveInboxSettingsAction,
    INITIAL,
  );
  useActionStatus(state === INITIAL ? null : state);
  const known = agentId === null || choices.some((c) => c.id === agentId);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <div className="space-y-1">
        <Label htmlFor="inbox-guids-agent" className="text-12">
          {t("agent")}
        </Label>
        <NativeSelect
          id="inbox-guids-agent"
          name="guids_agent_id"
          defaultValue={agentId ?? ""}
          disabled={!canWrite}
          className="w-full"
          data-testid="inbox-guids-agent"
        >
          <NativeSelectOption value="">{t("none")}</NativeSelectOption>
          {choices.map((choice) => (
            <NativeSelectOption
              key={choice.id}
              value={choice.id}
              disabled={!choice.active && choice.id !== agentId}
            >
              {choice.active ? choice.name : t("off", { name: choice.name })}
            </NativeSelectOption>
          ))}
          {!known && agentId ? (
            <NativeSelectOption value={agentId}>{t("gone")}</NativeSelectOption>
          ) : null}
        </NativeSelect>
        <p className="text-11 text-text-secondary">{t("agentHint")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {INBOX_SERVICE_FIELDS.map((field) => {
          const id = `inbox-service-${field.name}`;
          return (
            <div key={field.name} className="space-y-1">
              <Label htmlFor={id} className="text-12">
                {t(`fields.${field.name}`)}
              </Label>
              <Input
                id={id}
                name={field.name}
                type="number"
                inputMode="numeric"
                required
                min={field.min}
                max={field.max}
                step={field.step}
                defaultValue={service[field.name]}
                disabled={!canWrite}
              />
              <p className="text-11 text-text-secondary">
                {t(`hints.${field.name}`)}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-11 text-text-secondary">{t("backToBot")}</p>
      {canWrite ? (
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
      ) : (
        <p className="text-12 text-text-secondary">{t("viewOnly")}</p>
      )}
    </form>
  );
}
