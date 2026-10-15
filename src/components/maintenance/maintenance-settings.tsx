import { getFormatter, getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PartnerActionState } from "@/core/partners/actions";
import type { MaintenanceView } from "@/core/maintenance/service";
import {
  dateToZonedLocal,
  MAINTENANCE_MODES,
  MAINTENANCE_OPEN_ROUTES,
  MAINTENANCE_TIME_ZONE,
  MAX_MESSAGE_LENGTH,
} from "@/core/maintenance/state";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

const MESSAGE_FIELDS = [
  { name: "messagePtBr", locale: "pt-BR", label: "messagePtBr" },
  { name: "messageEn", locale: "en", label: "messageEn" },
  { name: "messageEs", locale: "es", label: "messageEs" },
] as const;

/**
 * Operações › Manutenção (CF5c): the state now, the form of the window
 * (mode, start, end and the message in the three languages), "end now",
 * and what each mode closes and keeps open.
 */
export async function MaintenanceSettings({
  view,
  saveAction,
  endAction,
}: Readonly<{ view: MaintenanceView; saveAction: Action; endAction: Action }>) {
  const t = await getTranslations("maintenance");
  const format = await getFormatter();
  const dateTime = (date: Date) =>
    format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: MAINTENANCE_TIME_ZONE,
    });
  const { record, status } = view;
  const local = (date: Date | null | undefined) =>
    date ? dateToZonedLocal(date, MAINTENANCE_TIME_ZONE) : undefined;

  let state: string;
  if (status.phase === "active") {
    state = status.window.endsAt
      ? t("state.activeUntil", { end: dateTime(status.window.endsAt) })
      : t("state.active");
  } else if (status.phase === "scheduled") {
    state = t("state.scheduled", {
      start: dateTime(status.window.startsAt ?? new Date()),
    });
  } else {
    state = t("state.off");
  }

  return (
    <>
      <SettingsCard
        title={t("state.title")}
        description={t("state.description")}
        testId="maintenance-state"
      >
        <InfoList
          items={[
            {
              label: t("state.label"),
              value: state,
              testId: "maintenance-phase",
            },
            {
              label: t("state.mode"),
              value:
                status.phase === "off"
                  ? t("state.none")
                  : t(`modes.${status.window.mode}`),
              testId: "maintenance-mode",
            },
            {
              label: t("state.updatedAt"),
              value: record ? dateTime(record.updatedAt) : t("state.never"),
            },
          ]}
        />
        {view.canEdit ? (
          // Always mounted, disabled while off: the form announces its own
          // result in the SmartStatusBanner after the page refreshes.
          <ActionForm
            action={endAction}
            submitLabel={t("form.end")}
            tone="neutral"
            testId="maintenance-end"
            disabled={status.phase === "off"}
          />
        ) : null}
      </SettingsCard>

      <SettingsCard
        title={t("form.title")}
        description={t("form.description")}
        testId="maintenance-form"
      >
        {view.canEdit ? (
          <ActionForm
            action={saveAction}
            submitLabel={t("form.save")}
            className="flex w-full flex-col items-start gap-4"
          >
            <Label className="text-14 gap-2 font-normal">
              <Checkbox
                name="enabled"
                defaultChecked={record?.enabled ?? false}
              />
              {t("form.enabled")}
            </Label>
            <Label className="w-full flex-col items-start">
              {t("form.mode")}
              <NativeSelect
                name="mode"
                defaultValue={record?.mode ?? "maintenance"}
                className="w-full sm:w-80"
              >
                {MAINTENANCE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`modes.${mode}`)}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <div className="grid w-full gap-4 sm:grid-cols-2">
              <Label className="flex-col items-start">
                {t("form.startsAt")}
                <Input
                  type="datetime-local"
                  name="startsAt"
                  defaultValue={local(record?.startsAt)}
                />
                <span className="text-12 text-text-secondary font-normal">
                  {t("form.startsAtHint")}
                </span>
              </Label>
              <Label className="flex-col items-start">
                {t("form.endsAt")}
                <Input
                  type="datetime-local"
                  name="endsAt"
                  defaultValue={local(record?.endsAt)}
                />
                <span className="text-12 text-text-secondary font-normal">
                  {t("form.endsAtHint")}
                </span>
              </Label>
            </div>
            <fieldset className="w-full space-y-3">
              <legend className="text-14 text-text font-medium">
                {t("form.messages")}
              </legend>
              {MESSAGE_FIELDS.map((field) => (
                <Label key={field.name} className="w-full flex-col items-start">
                  {t(`form.${field.label}`)}
                  <Textarea
                    name={field.name}
                    rows={2}
                    maxLength={MAX_MESSAGE_LENGTH}
                    defaultValue={record?.messages[field.locale] ?? ""}
                  />
                </Label>
              ))}
              <p className="text-12 text-text-secondary">
                {t("form.messagesHint")}
              </p>
            </fieldset>
          </ActionForm>
        ) : (
          <p className="text-12 text-text-secondary">{t("form.readOnly")}</p>
        )}
      </SettingsCard>

      <SettingsCard title={t("effects.title")} testId="maintenance-effects">
        <ul className="text-12 text-text-secondary list-disc space-y-1 pl-4">
          <li>{t("effects.maintenance")}</li>
          <li>{t("effects.readOnly")}</li>
          <li>{t("effects.jobs")}</li>
          <li>{t("effects.agents")}</li>
          <li>{t("effects.notice")}</li>
          <li>
            {t("effects.open")}{" "}
            <span className="font-mono">
              {MAINTENANCE_OPEN_ROUTES.join(", ")}
            </span>
          </li>
        </ul>
      </SettingsCard>
    </>
  );
}
