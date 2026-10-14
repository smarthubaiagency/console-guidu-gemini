"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  type ChannelActionState,
  updateServiceSettingsAction,
} from "@/core/channels/actions";
import type { ChannelConnectionDto } from "@/core/channels/connections";
import {
  resolveServiceSettings,
  type ServiceSettings,
  VOICE_REPLIES,
} from "@/core/channels/settings";

const FIELDS: readonly {
  name: Exclude<keyof ServiceSettings, "voice_reply">;
  min: number;
  max: number;
  step: number;
}[] = [
  { name: "grouping_seconds", min: 0, max: 30, step: 1 },
  { name: "max_messages", min: 1, max: 5, step: 1 },
  { name: "max_chars", min: 100, max: 1000, step: 50 },
  { name: "interval_ms", min: 0, max: 5000, step: 100 },
];

/**
 * Service settings of a connection (A5b): the defaults of every inbox, or
 * an inbox's own adjustment. Picking an inbox shows the values it uses
 * now; saving keeps them as its own, "Usar o padrão" drops them.
 */
export function ServiceSettingsForm({
  workspaceSlug,
  connection,
}: Readonly<{ workspaceSlug: string; connection: ChannelConnectionDto }>) {
  const t = useTranslations("channels.service");
  const [scope, setScope] = useState("defaults");
  const [state, action, pending] = useActionState<ChannelActionState, FormData>(
    updateServiceSettingsAction,
    {},
  );
  useActionStatus(state);
  const config = { service: connection.service };
  const values = resolveServiceSettings(
    config,
    scope === "defaults" ? null : scope,
  );
  const own = scope !== "defaults" && scope in connection.service.inboxes;
  const errors = state.fieldErrors ?? {};

  return (
    <form
      key={`${scope}:${JSON.stringify(values)}`}
      action={action}
      className="border-border space-y-3 rounded-lg border p-3"
      data-testid="channel-service"
    >
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="connectionId" value={connection.id} />
      <div className="space-y-1">
        <p className="text-12 text-text font-medium">{t("title")}</p>
        <p className="text-11 text-text-secondary">{t("description")}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`service-scope-${connection.id}`} className="text-12">
          {t("scope")}
        </Label>
        <NativeSelect
          id={`service-scope-${connection.id}`}
          name="scope"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          className="w-full"
          data-testid="channel-service-scope"
        >
          <NativeSelectOption value="defaults">
            {t("defaults")}
          </NativeSelectOption>
          {connection.inboxes.map((inbox) => (
            <NativeSelectOption key={inbox.id} value={String(inbox.id)}>
              {String(inbox.id) in connection.service.inboxes
                ? t("inboxOwn", { name: inbox.name })
                : inbox.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `service-${connection.id}-${field.name}`;
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
                defaultValue={values[field.name]}
                aria-invalid={errors[field.name] ? true : undefined}
              />
              <p className="text-11 text-text-secondary">
                {t(`hints.${field.name}`)}
              </p>
            </div>
          );
        })}
      </div>
      <div className="space-y-1">
        <Label
          htmlFor={`service-${connection.id}-voice_reply`}
          className="text-12"
        >
          {t("fields.voice_reply")}
        </Label>
        <NativeSelect
          id={`service-${connection.id}-voice_reply`}
          name="voice_reply"
          defaultValue={values.voice_reply}
          className="w-full"
        >
          {VOICE_REPLIES.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {t(`voiceReply.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-11 text-text-secondary">{t("hints.voice_reply")}</p>
      </div>
      <p className="text-11 text-text-secondary">{t("backToBot")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        {own ? (
          <Button
            type="submit"
            name="reset"
            value="1"
            size="sm"
            variant="outline"
            disabled={pending}
            formNoValidate
          >
            {t("useDefaults")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
