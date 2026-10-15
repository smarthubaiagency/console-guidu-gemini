import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { SettingsCard } from "@/components/settings/settings-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SecurityEventsPage } from "@/core/security/events";

const DATE_TIME = { dateStyle: "short", timeStyle: "medium" } as const;

/**
 * Segurança › Eventos (CF5a), read only: sign-ins, MFA, keys, roles and
 * security changes, newest first, 50 per page.
 */
export async function SecurityEvents({
  page,
  level,
  viewerId,
  basePath,
  paged,
}: Readonly<{
  page: SecurityEventsPage;
  level: "platform" | "partner";
  viewerId: string;
  basePath: string;
  /** True when this is not the first page. */
  paged: boolean;
}>) {
  const t = await getTranslations("security.events");
  const format = await getFormatter();

  const actionLabel = (action: string) => {
    const key = `actions.${action.replace(/\./g, "_")}`;
    return t.has(key) ? t(key) : action;
  };
  const actorLabel = (event: SecurityEventsPage["events"][number]) => {
    if (!event.actorUserId) return t("system");
    const name =
      event.actorEmail ?? t("user", { id: event.actorUserId.slice(0, 8) });
    return event.actorUserId === viewerId ? `${name} (${t("you")})` : name;
  };

  return (
    <SettingsCard
      title={t("title")}
      description={t(`description.${level}`)}
      testId="security-events"
    >
      {page.events.length === 0 ? (
        <p
          className="text-12 text-text-secondary"
          data-testid="security-events-empty"
        >
          {t("empty")}
        </p>
      ) : (
        <Table className="text-12" data-testid="security-events-table">
          <TableHeader className="text-left">
            <TableRow>
              <TableHead className="font-medium">{t("columns.when")}</TableHead>
              <TableHead className="font-medium">
                {t("columns.event")}
              </TableHead>
              <TableHead className="font-medium">{t("columns.who")}</TableHead>
              <TableHead className="font-medium">
                {t("columns.result")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.events.map((event) => (
              <TableRow key={event.id} data-testid="security-event">
                <TableCell className="text-text-secondary whitespace-nowrap">
                  {format.dateTime(event.occurredAt, DATE_TIME)}
                </TableCell>
                <TableCell>
                  <span className="text-text font-medium">
                    {actionLabel(event.action)}
                  </span>
                  <span className="text-text-tertiary ml-2 font-mono">
                    {event.action}
                  </span>
                </TableCell>
                <TableCell className="break-all">{actorLabel(event)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      event.result === "success" ? "secondary" : "destructive"
                    }
                  >
                    {t(`result.${event.result}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {paged || page.nextBefore ? (
        <div className="flex gap-2">
          {paged ? (
            <Button asChild size="sm" variant="outline">
              <Link href={basePath}>{t("newest")}</Link>
            </Button>
          ) : null}
          {page.nextBefore ? (
            <Button asChild size="sm" variant="outline">
              <Link
                href={`${basePath}?before=${encodeURIComponent(page.nextBefore)}`}
                data-testid="security-events-older"
              >
                {t("older")}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </SettingsCard>
  );
}
