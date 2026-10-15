import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { PageStatus } from "@/components/feedback/page-status";
import { PreferenceSwitch } from "@/components/notifications/preference-switch";
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
import {
  channelEnabled,
  NOTIFICATION_CHANNELS,
  PREFERENCE_EVENTS,
} from "@/core/notifications/channels";
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
  const preferences = await withIdentityContext(prisma, identity.userId, (tx) =>
    myPreferences(tx, identity.userId),
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
              </TableRow>
            </TableHeader>
            {EMAIL_TEMPLATE_GROUPS.map((group) => {
              const events = PREFERENCE_EVENTS.filter((e) => e.group === group);
              if (events.length === 0) return null;
              return (
                <TableBody key={group}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={NOTIFICATION_CHANNELS.length + 1}
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              );
            })}
          </Table>
        </section>
      </main>
    </PageStatus>
  );
}
