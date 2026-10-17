import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { PageStatus } from "@/components/feedback/page-status";
import { PreferenceSwitch } from "@/components/notifications/preference-switch";
import { ActionForm } from "@/components/partners/action-form";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUserPage } from "@/core/auth/page-guard";
import { saveMyWhatsappAction } from "@/core/events/h2-actions";
import { availableChannels } from "@/core/events/rules";
import { textKeyOf } from "@/core/events/texts";
import {
  channelEnabled,
  HUB_PREFERENCE_EVENTS,
  NOTIFICATION_CHANNELS,
  personChannelEnabled,
  PREFERENCE_EVENTS,
} from "@/core/notifications/channels";
import { myWhatsapp } from "@/core/notifications/whatsapp-number";
import { myPreferences } from "@/core/notifications/inbox";
import { EMAIL_TEMPLATE_GROUPS } from "@/core/notifications/template-catalog";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationCenter.preferences");
  return { title: t("metadataTitle") };
}

/**
 * Minha conta › Notificações (CF3c): the matrix of events and channels.
 * Essential events (security, billing) show locked on; the others save
 * each switch on change.
 */
export default async function AccountNotificationsPage() {
  const identity = await requireUserPage("/app/account/notifications");
  const t = await getTranslations("notificationCenter.preferences");
  const te = await getTranslations("email.templates");
  const { preferences, whatsapp } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      preferences: await myPreferences(tx, identity.userId),
      whatsapp: await myWhatsapp(tx, identity.userId),
    }),
  );
  const tw = await getTranslations("eventRules.whatsapp");
  const tn = await getTranslations("notifications.names");
  const format = await getFormatter();
  const whatsappCell = (type: string, name: string) => (
    <TableCell className="text-center">
      {whatsapp ? (
        <PreferenceSwitch
          eventType={type}
          channel="whatsapp"
          enabled={personChannelEnabled(type, "whatsapp", preferences)}
          label={t("toggle", { event: name, channel: tw("channel") })}
        />
      ) : (
        <span className="text-text-secondary" title={tw("noNumber")}>
          —
        </span>
      )}
    </TableCell>
  );

  return (
    <PageStatus>
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <Link href="/app" className="text-12 text-primary">
          ←
        </Link>
        <h1 className="text-30 mt-2 font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-text-secondary text-14 mt-2">
          {identity.email ?? identity.userId}
        </p>
        <section
          className="border-card-border bg-surface-card mt-8 space-y-4 rounded-xl border p-6 shadow-xs"
          data-testid="my-whatsapp"
        >
          <h2 className="text-16 text-text font-semibold">{tw("title")}</h2>
          <p className="text-12 text-text-secondary">{tw("description")}</p>
          {whatsapp ? (
            <p className="text-14 flex flex-wrap items-center gap-2">
              <span className="font-mono" data-testid="my-whatsapp-number">
                {whatsapp.phone}
              </span>
              <Badge variant="success">
                {tw("acceptedAt", {
                  date: format.dateTime(whatsapp.consentedAt, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "America/Sao_Paulo",
                  }),
                })}
              </Badge>
            </p>
          ) : null}
          <ActionForm
            action={saveMyWhatsappAction}
            submitLabel={tw("save")}
            className="flex flex-col items-start gap-3"
          >
            <div className="space-y-1">
              <Label htmlFor="my-whatsapp-phone" className="text-12">
                {tw("phone")}
              </Label>
              <Input
                id="my-whatsapp-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={whatsapp?.phone ?? ""}
                placeholder="+55 11 91234-5678"
                maxLength={32}
              />
            </div>
            <Label className="text-14 gap-2 font-normal">
              <Checkbox name="consent" defaultChecked={Boolean(whatsapp)} />
              {tw("consent")}
            </Label>
          </ActionForm>
          {whatsapp ? (
            <ActionForm
              action={saveMyWhatsappAction}
              submitLabel={tw("remove")}
              tone="neutral"
            >
              <input type="hidden" name="intent" value="remove" />
            </ActionForm>
          ) : null}
        </section>
        <section className="border-card-border bg-surface-card mt-8 space-y-4 rounded-xl border p-6 shadow-xs">
          <p className="text-14 text-text-secondary">{t("description")}</p>
          <p className="text-12 text-text-secondary flex items-center gap-2">
            <Lock className="size-3.5" aria-hidden />
            {t("lockedHint")}
          </p>
          <Table data-testid="notification-preferences-matrix">
            <TableHeader>
              <TableRow>
                <TableHead>{t("event")}</TableHead>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <TableHead key={channel} className="w-32 text-center">
                    {t(`channels.${channel}`)}
                  </TableHead>
                ))}
                <TableHead className="w-32 text-center">
                  {tw("channel")}
                </TableHead>
              </TableRow>
            </TableHeader>
            {EMAIL_TEMPLATE_GROUPS.map((group) => {
              const events = PREFERENCE_EVENTS.filter((e) => e.group === group);
              if (events.length === 0) return null;
              return (
                <TableBody key={group}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={NOTIFICATION_CHANNELS.length + 2}
                      className="text-12 text-text-secondary pt-4 font-semibold uppercase"
                    >
                      {te(`groups.${group}`)}
                    </TableCell>
                  </TableRow>
                  {events.map((event) => {
                    const name = te(`events.${event.key}.name`);
                    return (
                      <TableRow
                        key={event.type}
                        data-testid="notification-preference-row"
                        data-event={event.type}
                        data-locked={event.essential ? "true" : "false"}
                      >
                        <TableCell className="whitespace-normal">
                          <span className="text-14 text-text font-medium">
                            {name}
                          </span>
                          <span className="text-12 text-text-secondary block">
                            {te(`events.${event.key}.description`)}
                          </span>
                        </TableCell>
                        {NOTIFICATION_CHANNELS.map((channel) => {
                          const label = t("toggle", {
                            event: name,
                            channel: t(`channels.${channel}`),
                          });
                          const available = event.channels.includes(channel);
                          return (
                            <TableCell key={channel} className="text-center">
                              {!available ? (
                                <span
                                  className="text-text-secondary"
                                  title={t("unavailable")}
                                  aria-label={t("unavailable")}
                                >
                                  —
                                </span>
                              ) : event.essential ? (
                                <span
                                  className="inline-flex items-center gap-1.5"
                                  title={t("locked")}
                                >
                                  <Switch
                                    checked
                                    disabled
                                    aria-label={`${label} (${t("locked")})`}
                                    data-testid={`preference-${event.type}-${channel}`}
                                  />
                                  <Lock
                                    className="text-text-secondary size-3.5"
                                    aria-hidden
                                  />
                                </span>
                              ) : (
                                <PreferenceSwitch
                                  eventType={event.type}
                                  channel={channel}
                                  enabled={channelEnabled(
                                    event,
                                    channel,
                                    preferences,
                                  )}
                                  label={label}
                                />
                              )}
                            </TableCell>
                          );
                        })}
                        {whatsappCell(event.type, name)}
                      </TableRow>
                    );
                  })}
                </TableBody>
              );
            })}
            <TableBody>
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={NOTIFICATION_CHANNELS.length + 2}
                  className="text-12 text-text-secondary pt-4 font-semibold uppercase"
                >
                  {tw("hubGroup")}
                </TableCell>
              </TableRow>
              {HUB_PREFERENCE_EVENTS.map((definition) => {
                const name = tn(textKeyOf(definition.type));
                const channels = availableChannels(definition);
                return (
                  <TableRow
                    key={definition.type}
                    data-testid="notification-preference-hub-row"
                    data-event={definition.type}
                  >
                    <TableCell className="whitespace-normal">
                      <span className="text-14 text-text font-medium">
                        {name}
                      </span>
                    </TableCell>
                    {NOTIFICATION_CHANNELS.map((channel) => (
                      <TableCell key={channel} className="text-center">
                        {!channels.includes(channel) ? (
                          <span className="text-text-secondary">—</span>
                        ) : definition.essential ? (
                          <Switch
                            checked
                            disabled
                            aria-label={`${t("toggle", {
                              event: name,
                              channel: t(`channels.${channel}`),
                            })} (${t("locked")})`}
                          />
                        ) : (
                          <PreferenceSwitch
                            eventType={definition.type}
                            channel={channel}
                            enabled={personChannelEnabled(
                              definition.type,
                              channel,
                              preferences,
                            )}
                            label={t("toggle", {
                              event: name,
                              channel: t(`channels.${channel}`),
                            })}
                          />
                        )}
                      </TableCell>
                    ))}
                    {whatsappCell(definition.type, name)}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      </main>
    </PageStatus>
  );
}
