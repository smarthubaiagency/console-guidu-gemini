import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  AccessRequestForm,
  EventStatusButtons,
  GrantDataViewer,
} from "@/components/events/event-actions";
import { EventDataViewer } from "@/components/events/event-data-viewer";
import {
  EventSelectCheckbox,
  EventSelectionBar,
  EventSelectionProvider,
} from "@/components/events/event-selection";
import { EventTraceCards } from "@/components/events/event-trace";
import { PresentedDataCheck } from "@/components/events/presented-data-check";
import { RecordWorkbench } from "@/components/layout/workbench";
import { ModuleNotice } from "@/components/modules/module-notice";
import { KeyValueList } from "@/components/patterns/key-value-list";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  ACCESS_MAX_EVENTS,
  activeGrantFor,
  type AccessGrant,
  myAccessGrants,
} from "@/core/events/access";
import {
  EVENT_CATALOG,
  EVENT_MODULES,
  EVENT_SEVERITIES,
  EVENT_STATUSES,
} from "@/core/events/catalog";
import { type EventTrace, eventTrace } from "@/core/events/views";
import { platformGrants } from "@/core/module-runtime/loaders";
import {
  canReadAllData,
  canReadEvents,
  listPlatformEvents,
  myCapabilities,
  platformEventDetail,
  PlatformEventFilters,
  type PlatformEventDetail,
  type PlatformEventRow,
} from "@/core/events/platform";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events");
  return { title: t("metaTitle") };
}

const BASE = "/platform/events";

type SearchParams = Partial<
  Record<
    | "type"
    | "module"
    | "partner"
    | "customer"
    | "from"
    | "to"
    | "event"
    | "severity"
    | "status",
    string
  >
>;

const SEVERITY_BADGE = {
  info: "info",
  attention: "warning",
  urgent: "danger",
} as const;

const INTEGRITY_BADGE = {
  ok: "success",
  broken: "danger",
  unverifiable: "warning",
} as const;

const DELIVERY_BADGE: Record<
  string,
  "success" | "danger" | "warning" | "neutral"
> = {
  sent: "success",
  delivered: "success",
  failed: "danger",
  blocked_policy: "danger",
  skipped: "warning",
  pending: "neutral",
  queued: "neutral",
};

/**
 * Plataforma › Eventos (H1, ADR 0022): the situation of every event of the
 * Event Hub — type, customer, moment, seal, verification and deliveries —
 * with filters by type, module, partner, customer and period, and the
 * event in the drawer (ADR 0015) at `?event=<id>`. The data stays with the
 * customer; only `keychain` opens it, with MFA, a reason and audit.
 */
export default async function PlatformEventsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const identity = await requirePlatformAdminPage(BASE);
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const actor = {
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
  if (!canReadEvents(actor)) return <ModuleNotice variant="denied" />;

  const params = await searchParams;
  const filters = PlatformEventFilters.parse({
    type: params.type || undefined,
    module: params.module || undefined,
    partner: params.partner || undefined,
    customer: params.customer || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    severity: params.severity || undefined,
    status: params.status || undefined,
  });
  const filtered = Object.values(filters).some(Boolean);
  const editKey = params.event || null;

  const { events, everything, detail, capabilities, trace, accessGrants } =
    await withIdentityContext(prisma, identity.userId, async (tx) => ({
      events: await listPlatformEvents(tx, actor, filters, 100),
      everything: filtered
        ? await listPlatformEvents(tx, actor, {}, 200)
        : null,
      detail: editKey ? await platformEventDetail(tx, actor, editKey) : null,
      capabilities: await myCapabilities(tx, identity.userId),
      trace: editKey ? await eventTrace(tx, editKey) : null,
      accessGrants: editKey
        ? await myAccessGrants(tx, identity.userId, editKey)
        : [],
    }));
  const grants = platformGrants(actor.platformRole);
  const keychain = canReadAllData(actor, capabilities);

  const t = await getTranslations("events");
  const format = await getFormatter();
  const when = (date: Date) =>
    format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    });

  // Options of the partner and customer filters: the ones with events.
  const source = everything ?? events;
  const partners = new Map<string, string>();
  const customers = new Map<string, string>();
  for (const row of source) {
    if (row.partnerId)
      partners.set(row.partnerId, row.partnerName ?? row.partnerId);
    if (row.organizationId) {
      customers.set(
        row.organizationId,
        row.organizationName ?? row.organizationId,
      );
    }
  }

  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
  const href = (event?: string) => {
    const next = new URLSearchParams(query);
    if (event) next.set("event", event);
    const search = next.toString();
    return search ? `${BASE}?${search}` : BASE;
  };

  const customerOf = (row: PlatformEventRow) =>
    row.organizationName ?? row.partnerName ?? t("list.platform");
  const integrityBadge = (row: PlatformEventRow) => {
    const key = (row.integrity ?? "pending") as
      keyof typeof INTEGRITY_BADGE | "pending";
    return (
      <Badge
        variant={key === "pending" ? "neutral" : INTEGRITY_BADGE[key]}
        data-testid="event-integrity"
      >
        {t(`integrity.${key}`)}
      </Badge>
    );
  };

  const canRequest = grants("platform.events.request_access");
  const list = (
    <PageCanvas>
      <PageTitle
        icon={<Inbox className="size-6" />}
        title={t("title")}
        description={t("description")}
      />
      <Card variant="surface" className="px-4 sm:px-6">
        <form
          method="get"
          action={BASE}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="event-filters"
        >
          <div className="space-y-1">
            <Label htmlFor="events-type" className="text-12">
              {t("filters.type")}
            </Label>
            <NativeSelect
              id="events-type"
              name="type"
              defaultValue={filters.type ?? ""}
              className="w-full"
            >
              <NativeSelectOption value="">
                {t("filters.allTypes")}
              </NativeSelectOption>
              {EVENT_CATALOG.filter((definition) => !definition.inline).map(
                (definition) => (
                  <NativeSelectOption
                    key={definition.type}
                    value={definition.type}
                  >
                    {definition.type}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
          </div>
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
              <NativeSelectOption value="">
                {t("filters.allModules")}
              </NativeSelectOption>
              {EVENT_MODULES.map((module) => (
                <NativeSelectOption key={module} value={module}>
                  {module}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="events-partner" className="text-12">
              {t("filters.partner")}
            </Label>
            <NativeSelect
              id="events-partner"
              name="partner"
              defaultValue={filters.partner ?? ""}
              className="w-full"
            >
              <NativeSelectOption value="">
                {t("filters.allPartners")}
              </NativeSelectOption>
              {[...partners].map(([id, name]) => (
                <NativeSelectOption key={id} value={id}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
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
              <NativeSelectOption value="">
                {t("filters.allCustomers")}
              </NativeSelectOption>
              {[...customers].map(([id, name]) => (
                <NativeSelectOption key={id} value={id}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
                <NativeSelectOption value="">
                  {t("filters.allSeverities")}
                </NativeSelectOption>
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
                <NativeSelectOption value="">
                  {t("filters.allStatuses")}
                </NativeSelectOption>
                {EVENT_STATUSES.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {t(`status.${status}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="events-from" className="text-12">
                {t("filters.from")}
              </Label>
              <Input
                id="events-from"
                name="from"
                type="date"
                defaultValue={filters.from ?? ""}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="events-to" className="text-12">
                {t("filters.to")}
              </Label>
              <Input
                id="events-to"
                name="to"
                type="date"
                defaultValue={filters.to ?? ""}
              />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit">{t("filters.apply")}</Button>
            {filtered ? (
              <Button asChild variant="outline">
                <Link href={BASE}>{t("filters.clear")}</Link>
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {canRequest ? <EventSelectionBar level="platform" /> : null}
      <Card variant="panel" className="px-4 sm:px-6">
        <CardHeader className="px-0">
          <CardTitle>{t("list.title", { count: events.length })}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {events.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("list.empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2" data-testid="event-list">
              {events.map((row) => {
                const item = (
                  <Item
                    key={row.id}
                    variant="card"
                    size="sm"
                    data-testid="event-row"
                    data-event-type={row.type}
                    className={canRequest ? "min-w-0 flex-1" : undefined}
                    asChild
                  >
                    <Link
                      href={href(row.id)}
                      scroll={false}
                      aria-current={row.id === editKey ? "true" : undefined}
                    >
                      <ItemContent>
                        <ItemTitle className="font-mono">{row.type}</ItemTitle>
                        <ItemDescription>
                          {[
                            customerOf(row),
                            row.workspaceName,
                            when(row.occurredAt),
                            t("list.deliveries", { count: row.deliveries }),
                            row.failedDeliveries > 0
                              ? t("list.failed", {
                                  count: row.failedDeliveries,
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Badge
                          variant={
                            SEVERITY_BADGE[
                              row.severity as keyof typeof SEVERITY_BADGE
                            ] ?? "neutral"
                          }
                        >
                          {t(
                            `severity.${row.severity as keyof typeof SEVERITY_BADGE}`,
                          )}
                        </Badge>
                        {integrityBadge(row)}
                      </ItemActions>
                    </Link>
                  </Item>
                );
                if (!canRequest) return item;
                // Several events of one workspace in one request (AJ1).
                return (
                  <div key={row.id} className="flex items-start gap-2">
                    {row.workspaceId ? (
                      <EventSelectCheckbox
                        eventId={row.id}
                        workspaceId={row.workspaceId}
                        workspaceLabel={[customerOf(row), row.workspaceName]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                    ) : (
                      <span className="w-4 shrink-0" aria-hidden />
                    )}
                    {item}
                  </div>
                );
              })}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </PageCanvas>
  );
  const main = canRequest ? (
    <EventSelectionProvider max={ACCESS_MAX_EVENTS}>
      {list}
    </EventSelectionProvider>
  ) : (
    list
  );

  const panel = detail ? (
    <EventPanel
      detail={detail}
      trace={trace}
      accessGrant={activeGrantFor(accessGrants, detail.id)}
      accessPending={accessGrants.some((g) => g.status === "pending")}
      canRequest={canRequest}
      canManage={grants("platform.events.manage")}
      keychain={keychain}
      when={when}
      t={t}
      integrity={integrityBadge(detail)}
    />
  ) : null;

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("list.panelLabel")}
      closeHref={href()}
      editKey={editKey}
      defaultPanelSize="wide"
    />
  );
}

async function EventPanel({
  detail,
  trace,
  accessGrant,
  accessPending,
  canRequest,
  canManage,
  keychain,
  when,
  t,
  integrity,
}: Readonly<{
  detail: PlatformEventDetail;
  trace: EventTrace | null;
  accessGrant: AccessGrant | null;
  accessPending: boolean;
  canRequest: boolean;
  canManage: boolean;
  keychain: boolean;
  when: (date: Date) => string;
  t: Awaited<ReturnType<typeof getTranslations<"events">>>;
  integrity: React.ReactNode;
}>) {
  const ta = await getTranslations("eventRules.access");
  const mono = (value: string) => (
    <span className="text-12 font-mono break-all">{value}</span>
  );
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" data-testid="event-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          className="text-18 text-text font-mono font-semibold"
          data-testid="event-panel-type"
        >
          {detail.type}
        </h2>
        <Badge
          variant={
            SEVERITY_BADGE[detail.severity as keyof typeof SEVERITY_BADGE] ??
            "neutral"
          }
        >
          {t(`severity.${detail.severity as keyof typeof SEVERITY_BADGE}`)}
        </Badge>
      </div>

      {canManage && detail.level === "platform" ? (
        <EventStatusButtons
          scope={{ level: "platform" }}
          eventId={detail.id}
          status={detail.status}
        />
      ) : null}
      <Card variant="surface" className="px-4">
        <CardHeader className="px-0">
          <CardTitle>{t("detail.situation")}</CardTitle>
          <CardDescription>{t("detail.dataHidden")}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <KeyValueList
            items={[
              { label: t("detail.eventId"), value: mono(detail.id) },
              { label: t("detail.module"), value: detail.module },
              {
                label: t("detail.status"),
                value: t(`status.${detail.status as "open"}`),
              },
              { label: t("detail.occurredAt"), value: when(detail.occurredAt) },
              {
                label: t("detail.partner"),
                value: detail.partnerName ?? detail.partnerId ?? "-",
              },
              {
                label: t("detail.customer"),
                value: detail.organizationName ?? detail.organizationId ?? "-",
              },
              {
                label: t("detail.workspace"),
                value: detail.workspaceName ?? detail.workspaceId ?? "-",
              },
              {
                label: t("detail.subject"),
                value: detail.subjectType
                  ? mono(`${detail.subjectType}:${detail.subjectId ?? ""}`)
                  : "-",
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card variant="surface" className="px-4" data-testid="event-seal">
        <CardHeader className="px-0">
          <CardTitle>{t("detail.seal")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0">
          <div className="flex flex-wrap gap-2">
            {integrity}
            <Badge
              variant={detail.chainOk ? "success" : "danger"}
              data-testid="event-chain"
            >
              {detail.chainOk ? t("chain.ok") : t("chain.broken")}
            </Badge>
          </div>
          <KeyValueList
            items={[
              {
                label: t("detail.contentHash"),
                value: mono(detail.contentHash),
              },
              {
                label: t("detail.prevHash"),
                value: detail.prevHash
                  ? mono(detail.prevHash)
                  : t("detail.none"),
              },
              { label: t("detail.keyVersion"), value: mono(detail.keyVersion) },
              { label: t("detail.chainKey"), value: mono(detail.chainKey) },
              { label: t("detail.position"), value: String(detail.seq) },
              {
                label: t("detail.verifiedAt"),
                value: detail.verifiedAt
                  ? when(detail.verifiedAt)
                  : t("detail.never"),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card variant="surface" className="px-4" data-testid="event-deliveries">
        <CardHeader className="px-0">
          <CardTitle>{t("detail.deliveries")}</CardTitle>
          <CardDescription>
            {t("detail.dispatchedAt")}:{" "}
            {detail.dispatchedAt
              ? when(detail.dispatchedAt)
              : t("detail.notDispatched")}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {detail.deliveryList.length === 0 ? (
            <p className="text-12 text-text-secondary">
              {t("detail.noDeliveries")}
            </p>
          ) : (
            <ItemGroup className="gap-2">
              {detail.deliveryList.map((delivery) => (
                <Item
                  key={delivery.id}
                  variant="inset"
                  size="sm"
                  data-testid="event-delivery"
                >
                  <ItemContent>
                    <ItemTitle>
                      {t(`channels.${delivery.channel as "email"}`)}
                    </ItemTitle>
                    <ItemDescription>
                      {[
                        delivery.reason,
                        delivery.provider,
                        t("detail.attempts", { count: delivery.attempts }),
                        when(delivery.updatedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge
                      variant={DELIVERY_BADGE[delivery.status] ?? "neutral"}
                    >
                      {t(`delivery.${delivery.status as "sent"}`)}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      {trace ? <EventTraceCards trace={trace} deliveries={false} /> : null}

      {canRequest && detail.level === "workspace" ? (
        <Card variant="surface" className="px-4">
          <CardHeader className="px-0">
            <CardTitle>{ta("title")}</CardTitle>
            <CardDescription>
              {accessGrant
                ? ta("granted", {
                    date: accessGrant.expiresAt
                      ? when(accessGrant.expiresAt)
                      : "-",
                  })
                : accessPending
                  ? ta("waiting")
                  : ta("description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {accessGrant ? (
              <GrantDataViewer
                level="platform"
                eventId={detail.id}
                grantId={accessGrant.id}
              />
            ) : accessPending ? null : (
              <AccessRequestForm level="platform" eventIds={[detail.id]} />
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card variant="surface" className="px-4">
        <CardHeader className="px-0">
          <CardTitle>{t("check.title")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <PresentedDataCheck eventId={detail.id} />
        </CardContent>
      </Card>

      {keychain ? (
        <Card variant="surface" className="px-4">
          <CardHeader className="px-0">
            <CardTitle>{t("keychain.title")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <EventDataViewer key={detail.id} eventId={detail.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
