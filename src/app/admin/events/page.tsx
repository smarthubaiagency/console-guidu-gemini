import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  AccessRequestForm,
  EventStatusButtons,
  GrantDataViewer,
} from "@/components/events/event-actions";
import { EventTraceCards } from "@/components/events/event-trace";
import {
  EventFilters,
  EventList,
  SEVERITY_BADGE,
  STATUS_BADGE,
} from "@/components/events/events-list";
import { RecordWorkbench } from "@/components/layout/workbench";
import { ModuleNotice } from "@/components/modules/module-notice";
import { KeyValueList } from "@/components/patterns/key-value-list";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { activeGrantFor, myAccessGrants } from "@/core/events/access";
import { textKeyOf } from "@/core/events/texts";
import {
  EventListFilters,
  eventTrace,
  listPartnerEvents,
} from "@/core/events/views";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("eventRules.events");
  return { title: t("metaTitle") };
}

const BASE = "/admin/events";

type SearchParams = Partial<
  Record<"module" | "severity" | "status" | "customer" | "event", string>
>;

/**
 * Admin › Eventos (H2): the events of the partner's customers and of the
 * partner itself. The data only where the partner manages the company (or
 * the event is the partner's); elsewhere the situation, and the partner
 * asks the customer for the data (ADR 0022 item 7).
 */
export default async function PartnerEventsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const { identity, partner, membership } = await requirePartnerConsolePage(BASE);
  const grants = partnerGrants(membership.role);
  if (!grants("partner.events.read")) return <ModuleNotice variant="denied" />;
  const query = await searchParams;
  const filters = EventListFilters.parse({
    module: query.module || undefined,
    severity: query.severity || undefined,
    status: query.status || undefined,
    customer: query.customer || undefined,
  });
  const editKey = query.event || null;
  const data = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => {
      const all = await listPartnerEvents(tx, partner.partnerId, {});
      const rows = await listPartnerEvents(tx, partner.partnerId, filters);
      const detail = editKey ? (all.find((row) => row.id === editKey) ?? null) : null;
      return {
        all,
        rows,
        detail,
        trace: detail ? await eventTrace(tx, detail.id) : null,
        accessGrants: detail ? await myAccessGrants(tx, identity.userId, detail.id) : [],
      };
    },
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("eventRules.events");
  const ta = await getTranslations("eventRules.access");
  const tn = await getTranslations("notifications.names");
  const format = await getFormatter();
  const when = (date: Date) =>
    format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    });
  const customers = new Map<string, string>();
  for (const row of data.all) {
    if (row.organizationId) {
      customers.set(row.organizationId, row.organizationName ?? row.organizationId);
    }
  }
  const search = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
  const href = (event?: string) => {
    const next = new URLSearchParams(search);
    if (event) next.set("event", event);
    const text = next.toString();
    return text ? `${BASE}?${text}` : BASE;
  };

  const main = (
    <PageCanvas>
      <PageTitle
        icon={<Activity className="size-6" />}
        title={t("title")}
        description={t("description.partner")}
      />
      <EventFilters base={BASE} filters={filters} customers={customers} />
      <EventList rows={data.rows} href={(id) => href(id)} current={editKey} />
    </PageCanvas>
  );

  const detail = data.detail;
  const grant = detail ? activeGrantFor(data.accessGrants, detail.id) : null;
  const pending = data.accessGrants.find((g) => g.status === "pending") ?? null;
  const canRequest = grants("partner.events.request_access");
  const panel = detail ? (
    <div className="flex flex-col gap-4 p-4 md:p-6" data-testid="event-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-18 text-text font-semibold" data-testid="event-panel-type">
          {tn(textKeyOf(detail.type))}
        </h2>
        <Badge variant={SEVERITY_BADGE[detail.severity] ?? "neutral"}>
          {t(`severity.${detail.severity}`)}
        </Badge>
        <Badge variant={STATUS_BADGE[detail.status] ?? "neutral"}>
          {t(`status.${detail.status}`)}
        </Badge>
      </div>
      {detail.data ? (
        <EventStatusButtons
          scope={{ level: "partner" }}
          eventId={detail.id}
          status={detail.status}
        />
      ) : null}
      <Card variant="surface" className="px-4">
        <CardHeader className="px-0">
          <CardTitle>{t("whatHappened")}</CardTitle>
          {detail.data ? null : (
            <CardDescription>{t("dataHidden")}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="px-0">
          <KeyValueList
            items={[
              {
                label: t("eventId"),
                value: <span className="text-12 font-mono break-all">{detail.id}</span>,
              },
              { label: t("type"), value: detail.type },
              { label: t("customer"), value: detail.organizationName ?? "-" },
              { label: t("occurredAt"), value: when(detail.occurredAt) },
              {
                label: t("seal"),
                value: (
                  <span className="text-12 font-mono break-all">{detail.contentHash}</span>
                ),
              },
            ]}
          />
          {detail.data ? (
            <pre
              className="bg-surface-inset rounded-inner text-12 text-text mt-3 max-h-72 overflow-auto p-3 font-mono break-all whitespace-pre-wrap"
              data-testid="event-panel-data"
            >
              {JSON.stringify(detail.data, null, 2)}
            </pre>
          ) : null}
        </CardContent>
      </Card>
      {!detail.data && detail.workspaceId && canRequest ? (
        <Card variant="surface" className="px-4">
          <CardHeader className="px-0">
            <CardTitle>{ta("title")}</CardTitle>
            <CardDescription>
              {grant
                ? ta("granted", { date: grant.expiresAt ? when(grant.expiresAt) : "-" })
                : pending
                  ? ta("waiting")
                  : ta("description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {grant ? (
              <GrantDataViewer level="partner" eventId={detail.id} grantId={grant.id} />
            ) : pending ? null : (
              <AccessRequestForm level="partner" eventId={detail.id} />
            )}
          </CardContent>
        </Card>
      ) : null}
      {data.trace ? <EventTraceCards trace={data.trace} /> : null}
    </div>
  ) : null;

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("panelLabel")}
      closeHref={href()}
      editKey={editKey}
      defaultPanelSize="wide"
    />
  );
}
