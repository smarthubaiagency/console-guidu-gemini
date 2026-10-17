import Link from "next/link";
import { Lock } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_CHANNELS } from "@/core/events/catalog";
import { availableChannels, presetOf, presetsFor } from "@/core/events/rules";
import type { NotificationSettingsView } from "@/core/events/rules-service";
import {
  textKeyOf,
  WHATSAPP_TEXT_TYPES,
  whatsappTags,
} from "@/core/events/texts";
import type { WhatsappTemplateVersion } from "@/core/events/whatsapp-templates";
import type { PartnerActionState } from "@/core/partners/actions";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

export const TEMPLATE_LOCALES = ["pt-BR", "en", "es"] as const;

/**
 * Configurações › Notificações (H2, ADR 0018 two cards): the matrix of
 * event × channel × recipients × delivery (and the escalation of the
 * approvals), the locks of the level, the quiet window, the digest time
 * and, at the platform and the partner, the versioned WhatsApp texts.
 * A type locked above is shown read-only.
 */
export async function NotificationRulesCard({
  data,
  action,
  hidden,
}: Readonly<{
  data: NotificationSettingsView;
  action: Action;
  hidden?: Readonly<Record<string, string>>;
}>) {
  const t = await getTranslations("eventRules.settings");
  const tn = await getTranslations("notifications.names");
  const level = data.view.level;
  const canLock = level !== "workspace";
  const editable = data.view.canEdit;
  const types = data.lines
    .filter((line) => !line.lockedAbove)
    .map((line) => line.definition.type);

  const table = (
    <Table data-testid="notification-rules">
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.event")}</TableHead>
          <TableHead className="text-center">{t("columns.enabled")}</TableHead>
          {EVENT_CHANNELS.map((channel) => (
            <TableHead key={channel} className="text-center">
              {t(`channels.${channel}`)}
            </TableHead>
          ))}
          <TableHead>{t("columns.recipients")}</TableHead>
          <TableHead>{t("columns.delivery")}</TableHead>
          <TableHead>{t("columns.escalation")}</TableHead>
          {canLock ? (
            <TableHead className="text-center">{t("columns.lock")}</TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.lines.map((line) => {
          const { definition, effective } = line;
          const type = definition.type;
          const disabled = !editable || line.lockedAbove;
          const name = tn(textKeyOf(type));
          const allowed = availableChannels(definition);
          const presets = presetsFor(definition);
          const current = presetOf(effective.recipients);
          return (
            <TableRow
              key={type}
              data-testid="notification-rule"
              data-event={type}
              data-locked={line.lockedAbove ? "true" : "false"}
            >
              <TableCell className="whitespace-normal">
                <span className="text-14 text-text font-medium">{name}</span>
                <span className="text-12 text-text-secondary block font-mono">
                  {type}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {definition.essential ? (
                    <Badge variant="neutral">{t("essential")}</Badge>
                  ) : null}
                  {line.lockedAbove ? (
                    <Badge variant="warning">
                      <Lock aria-hidden />
                      {t("lockedAbove")}
                    </Badge>
                  ) : line.own ? (
                    <Badge variant="info">{t("own")}</Badge>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="text-center">
                <Checkbox
                  name={`rule:${type}:enabled`}
                  defaultChecked={effective.enabled}
                  disabled={disabled || definition.essential}
                  aria-label={t("toggleEnabled", { event: name })}
                />
              </TableCell>
              {EVENT_CHANNELS.map((channel) => (
                <TableCell key={channel} className="text-center">
                  {allowed.includes(channel) ? (
                    <Checkbox
                      name={`rule:${type}:channel:${channel}`}
                      defaultChecked={effective.channels.includes(channel)}
                      disabled={disabled}
                      aria-label={t("toggleChannel", {
                        event: name,
                        channel: t(`channels.${channel}`),
                      })}
                      data-testid={`rule-${type}-${channel}`}
                    />
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </TableCell>
              ))}
              <TableCell>
                {presets.length > 1 ? (
                  <NativeSelect
                    name={`rule:${type}:recipients`}
                    defaultValue={current === "custom" ? "route" : current}
                    disabled={disabled}
                    aria-label={t("columns.recipients")}
                    size="sm"
                  >
                    {presets.map((preset) => (
                      <NativeSelectOption key={preset} value={preset}>
                        {t(`recipients.${preset}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <span className="text-12 text-text-secondary">
                    {t("recipients.route")}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <NativeSelect
                  name={`rule:${type}:delivery`}
                  defaultValue={effective.delivery}
                  disabled={disabled}
                  aria-label={t("columns.delivery")}
                  size="sm"
                  data-testid={`rule-${type}-delivery`}
                >
                  <NativeSelectOption value="immediate">
                    {t("delivery.immediate")}
                  </NativeSelectOption>
                  <NativeSelectOption value="digest">
                    {t("delivery.digest")}
                  </NativeSelectOption>
                </NativeSelect>
              </TableCell>
              <TableCell>
                {definition.approval ? (
                  <div className="flex flex-col gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={720}
                      name={`rule:${type}:escalate_after_hours`}
                      defaultValue={effective.escalateAfterHours ?? ""}
                      disabled={disabled}
                      placeholder={t("escalation.hours")}
                      aria-label={t("escalation.hours")}
                      className="w-24"
                    />
                    <NativeSelect
                      name={`rule:${type}:escalate_to`}
                      defaultValue={
                        effective.escalateTo.length > 0
                          ? presetOf(effective.escalateTo)
                          : ""
                      }
                      disabled={disabled}
                      aria-label={t("escalation.to")}
                      size="sm"
                    >
                      <NativeSelectOption value="">
                        {t("escalation.none")}
                      </NativeSelectOption>
                      {presets
                        .filter((preset) => preset !== "route")
                        .map((preset) => (
                          <NativeSelectOption key={preset} value={preset}>
                            {t(`recipients.${preset}`)}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </div>
                ) : (
                  <span className="text-text-secondary">—</span>
                )}
              </TableCell>
              {canLock ? (
                <TableCell className="text-center">
                  <Checkbox
                    name={`rule:${type}:locked`}
                    defaultChecked={effective.locked && line.own}
                    disabled={disabled}
                    aria-label={t("toggleLock", { event: name })}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <SettingsCard
      title={t("rulesTitle")}
      description={t(`rulesDescription.${level}`)}
      testId="notification-rules-card"
    >
      {editable ? (
        <ActionForm
          action={action}
          submitLabel={t("saveRules")}
          className="flex flex-col items-start gap-3"
        >
          {Object.entries(hidden ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input type="hidden" name="rules:types" value={types.join(",")} />
          <div className="w-full overflow-x-auto">{table}</div>
          <p className="text-12 text-text-secondary">{t("rulesHint")}</p>
        </ActionForm>
      ) : (
        <>
          <div className="w-full overflow-x-auto">{table}</div>
          <p className="text-12 text-text-secondary">{t("readOnly")}</p>
        </>
      )}
    </SettingsCard>
  );
}

export async function NotificationScheduleCard({
  data,
  action,
  hidden,
}: Readonly<{
  data: NotificationSettingsView;
  action: Action;
  hidden?: Readonly<Record<string, string>>;
}>) {
  const t = await getTranslations("eventRules.settings");
  const level = data.view.level;
  const canLock = level !== "workspace";
  const quietDisabled = !data.view.canEdit || data.quietLockedAbove;
  const digestDisabled = !data.view.canEdit || data.digestLockedAbove;
  const fields = (
    <div className="grid w-full gap-4 md:grid-cols-2">
      <fieldset className="space-y-2" data-testid="quiet-hours">
        <legend className="text-14 text-text font-medium">
          {t("quiet.title")}
        </legend>
        <p className="text-12 text-text-secondary">{t("quiet.description")}</p>
        <Label className="text-14 gap-2 font-normal">
          <Checkbox
            name="quiet:enabled"
            defaultChecked={data.quiet.enabled}
            disabled={quietDisabled}
          />
          {t("quiet.enabled")}
        </Label>
        <div className="flex gap-3">
          <div className="space-y-1">
            <Label htmlFor="quiet-start" className="text-12">
              {t("quiet.start")}
            </Label>
            <Input
              id="quiet-start"
              type="time"
              name="quiet:start"
              defaultValue={data.quiet.start}
              disabled={quietDisabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="quiet-end" className="text-12">
              {t("quiet.end")}
            </Label>
            <Input
              id="quiet-end"
              type="time"
              name="quiet:end"
              defaultValue={data.quiet.end}
              disabled={quietDisabled}
            />
          </div>
        </div>
        <Label className="text-14 gap-2 font-normal">
          <Checkbox
            name="quiet:sundays"
            defaultChecked={data.quiet.sundays}
            disabled={quietDisabled}
          />
          {t("quiet.sundays")}
        </Label>
        {level !== "platform" ? (
          <Label className="text-14 gap-2 font-normal">
            <Checkbox
              name="quiet:inherit"
              defaultChecked={!data.quietOwn}
              disabled={quietDisabled}
            />
            {t("inherit")}
          </Label>
        ) : null}
        {canLock ? (
          <Label className="text-14 gap-2 font-normal">
            <Checkbox
              name="quiet:locked"
              defaultChecked={data.quietLocked}
              disabled={quietDisabled}
            />
            {t("lock")}
          </Label>
        ) : null}
        {data.quietLockedAbove ? (
          <Badge variant="warning">{t("lockedAbove")}</Badge>
        ) : null}
      </fieldset>
      <fieldset className="space-y-2" data-testid="digest-time">
        <legend className="text-14 text-text font-medium">
          {t("digest.title")}
        </legend>
        <p className="text-12 text-text-secondary">{t("digest.description")}</p>
        <div className="space-y-1">
          <Label htmlFor="digest-time" className="text-12">
            {t("digest.time")}
          </Label>
          <Input
            id="digest-time"
            type="time"
            name="digest:time"
            defaultValue={data.digestTime}
            disabled={digestDisabled}
          />
        </div>
        {level !== "platform" ? (
          <Label className="text-14 gap-2 font-normal">
            <Checkbox
              name="digest:inherit"
              defaultChecked={!data.digestOwn}
              disabled={digestDisabled}
            />
            {t("inherit")}
          </Label>
        ) : null}
        {canLock ? (
          <Label className="text-14 gap-2 font-normal">
            <Checkbox
              name="digest:locked"
              defaultChecked={data.digestLocked}
              disabled={digestDisabled}
            />
            {t("lock")}
          </Label>
        ) : null}
        {data.digestLockedAbove ? (
          <Badge variant="warning">{t("lockedAbove")}</Badge>
        ) : null}
      </fieldset>
    </div>
  );
  return (
    <SettingsCard
      title={t("scheduleTitle")}
      description={t("scheduleDescription")}
      testId="notification-schedule-card"
    >
      {data.view.canEdit ? (
        <ActionForm
          action={action}
          submitLabel={t("saveSchedule")}
          className="flex flex-col items-start gap-3"
        >
          {Object.entries(hidden ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {fields}
        </ActionForm>
      ) : (
        fields
      )}
    </SettingsCard>
  );
}

export async function WhatsappTemplatesCard({
  base,
  eventType,
  locale,
  current,
  versions,
  canEdit,
  action,
}: Readonly<{
  base: string;
  eventType: string;
  locale: string;
  current: Readonly<{ body: string; source: "own" | "platform" | "default" }>;
  versions: readonly WhatsappTemplateVersion[];
  canEdit: boolean;
  action: Action;
}>) {
  const t = await getTranslations("eventRules.templates");
  const tn = await getTranslations("notifications.names");
  const format = await getFormatter();
  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      testId="whatsapp-templates"
    >
      <form
        method="get"
        action={base}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="space-y-1">
          <Label htmlFor="template-type" className="text-12">
            {t("event")}
          </Label>
          <NativeSelect
            id="template-type"
            name="template"
            defaultValue={eventType}
          >
            {WHATSAPP_TEXT_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {tn(textKeyOf(type))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="template-locale" className="text-12">
            {t("language")}
          </Label>
          <NativeSelect
            id="template-locale"
            name="locale"
            defaultValue={locale}
          >
            {TEMPLATE_LOCALES.map((code) => (
              <NativeSelectOption key={code} value={code}>
                {code}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" size="sm">
          {t("open")}
        </Button>
      </form>
      <p className="text-12 text-text-secondary">
        {t(`source.${current.source}`)} ·{" "}
        {t("tags", {
          tags: whatsappTags(eventType)
            .map((tag) => `{{${tag}}}`)
            .join(" "),
        })}
      </p>
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <ActionForm
            action={action}
            submitLabel={t("save")}
            className="flex w-full flex-col items-start gap-2"
            testId="whatsapp-template-form"
          >
            <input type="hidden" name="eventType" value={eventType} />
            <input type="hidden" name="locale" value={locale} />
            <Label htmlFor="template-body" className="text-12">
              {t("body")}
            </Label>
            <Textarea
              id="template-body"
              name="body"
              defaultValue={current.body}
              maxLength={1000}
              rows={4}
              className="w-full"
            />
          </ActionForm>
          {current.source === "own" ? (
            <ActionForm
              action={action}
              submitLabel={t("restore")}
              tone="neutral"
            >
              <input type="hidden" name="eventType" value={eventType} />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="intent" value="restore" />
            </ActionForm>
          ) : null}
        </div>
      ) : (
        <p className="text-14 whitespace-pre-wrap">{current.body}</p>
      )}
      {versions.length > 0 ? (
        <ItemGroup className="gap-2" data-testid="whatsapp-template-versions">
          {versions.map((version) => (
            <Item key={version.id} variant="inset" size="sm">
              <ItemContent>
                <ItemTitle>
                  {t("version", { version: version.version })}
                  {version.isCurrent ? (
                    <Badge variant="success">{t("current")}</Badge>
                  ) : null}
                </ItemTitle>
                <ItemDescription className="whitespace-pre-wrap">
                  {format.dateTime(version.createdAt, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "America/Sao_Paulo",
                  })}{" "}
                  · {version.body}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <p className="text-12 text-text-secondary">{t("noVersions")}</p>
      )}
      <p className="text-12 text-text-secondary">
        <Link href={base} className="text-primary">
          {t("reset")}
        </Link>
      </p>
    </SettingsCard>
  );
}
