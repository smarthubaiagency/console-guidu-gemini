import Link from "next/link";
import { Activity } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
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
  EVENT_MODULES,
  EVENT_SEVERITIES,
  EVENT_STATUSES,
} from "@/core/events/catalog";
import { textKeyOf } from "@/core/events/texts";
import type { EventListFilters, EventListRow } from "@/core/events/views";

export const SEVERITY_BADGE = {
  info: "info",
  attention: "warning",
  urgent: "danger",
} as const;

export const STATUS_BADGE: Record<
  string,
  "success" | "danger" | "warning" | "neutral" | "info"
> = {
  open: "info",
  resolved: "success",
  dismissed: "neutral",
  pending: "warning",
  approved: "success",
  denied: "danger",
  expired: "neutral",
};

/** Filters of the Eventos screens (H2): module, severity, status, customer. */
export async function EventFilters({
  base,
  filters,
  customers,
}: Readonly<{
  base: string;
  filters: EventListFilters;
  customers?: ReadonlyMap<string, string>;
}>) {
  const t = await getTranslations("eventRules.events");
  const filtered = Object.values(filters).some(Boolean);
  return (
    <Card variant="surface" className="px-4 sm:px-6">
      <form
        method="get"
        action={base}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="events-filters"
      >
        <div className="space-y-1">
          <Label htmlFor="events-module" className="text-12">
            {t("filters.module")}
          </Label>
          <NativeSelect
            id="events-module"
            name="module"
            defaultValue={filters.module ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
            {EVENT_MODULES.map((module) => (
              <NativeSelectOption key={module} value={module}>
                {module}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="events-severity" className="text-12">
            {t("filters.severity")}
          </Label>
          <NativeSelect
            id="events-severity"
            name="severity"
            defaultValue={filters.severity ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
            {EVENT_SEVERITIES.map((severity) => (
              <NativeSelectOption key={severity} value={severity}>
                {t(`severity.${severity}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="events-status" className="text-12">
            {t("filters.status")}
          </Label>
          <NativeSelect
            id="events-status"
            name="status"
            defaultValue={filters.status ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
            {EVENT_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {t(`status.${status}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {customers ? (
          <div className="space-y-1">
            <Label htmlFor="events-customer" className="text-12">
              {t("filters.customer")}
            </Label>
            <NativeSelect
              id="events-customer"
              name="customer"
              defaultValue={filters.customer ?? ""}
              className="w-full"
            >
              <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
              {[...customers].map(([id, name]) => (
                <NativeSelectOption key={id} value={id}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Button type="submit">{t("filters.apply")}</Button>
          {filtered ? (
            <Button asChild variant="outline">
              <Link href={base}>{t("filters.clear")}</Link>
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

/** The list of events; each row opens the drawer at `?event=<id>`. */
export async function EventList({
  rows,
  href,
  current,
}: Readonly<{
  rows: readonly EventListRow[];
  href: (eventId: string) => string;
  current: string | null;
}>) {
  const t = await getTranslations("eventRules.events");
  const tn = await getTranslations("notifications.names");
  const format = await getFormatter();
  return (
    <Card variant="panel" className="px-4 sm:px-6">
      <CardHeader className="px-0">
        <CardTitle>{t("listTitle", { count: rows.length })}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Activity />
              </EmptyMedia>
              <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("empty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2" data-testid="events-list">
            {rows.map((row) => (
              <Item
                key={row.id}
                variant="card"
                size="sm"
                data-testid="events-row"
                data-event-type={row.type}
                asChild
              >
                <Link
                  href={href(row.id)}
                  scroll={false}
                  aria-current={row.id === current ? "true" : undefined}
                >
                  <ItemContent>
                    <ItemTitle>{tn(textKeyOf(row.type))}</ItemTitle>
                    <ItemDescription>
                      {[
                        row.organizationName,
                        row.module,
                        format.dateTime(row.occurredAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "America/Sao_Paulo",
                        }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={SEVERITY_BADGE[row.severity] ?? "neutral"}>
                      {t(`severity.${row.severity}`)}
                    </Badge>
                    <Badge
                      variant={STATUS_BADGE[row.status] ?? "neutral"}
                      data-testid="events-row-status"
                    >
                      {t(`status.${row.status}`)}
                    </Badge>
                  </ItemActions>
                </Link>
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}
