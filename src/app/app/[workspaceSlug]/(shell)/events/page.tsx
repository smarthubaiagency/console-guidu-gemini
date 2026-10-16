import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  AccessDecision,
  EventStatusButtons,
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { requireUserPage } from "@/core/auth/page-guard";
import { workspaceAccessGrants } from "@/core/events/access";
import { textKeyOf } from "@/core/events/texts";
import {
  EventListFilters,
  eventTrace,
  listWorkspaceEvents,
} from "@/core/events/views";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { listWorkspaceMembers } from "@/core/workspaces/members";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("eventRules.events");
  return { title: t("metaTitle") };
}

type SearchParams = Partial<
  Record<"module" | "severity" | "status" | "event" | "grant", string>
>;

/**
 * Workspace › Eventos (H2, ADR 0022): what happened in the workspace, with
 * filters; the event in the drawer (ADR 0015) with its data and its full
 * trace (who was told, on which channel, what was audited and who saw the
 * data with a grant); resolve or dismiss; and the requests for the data of
 * events, which the owner and admins approve, deny or revoke.
 */
export default async function WorkspaceEventsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<SearchParams>;
}>) {
  const { workspaceSlug } = await params;
  const base = `/app/${workspaceSlug}/events`;
  const identity = await requireUserPage(base);
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const query = await searchParams;
  const filters = EventListFilters.parse({
    module: query.module || undefined,
    severity: query.severity || undefined,
    status: query.status || undefined,
  });
  const editKey = query.event || null;

  const data = await withContext(prisma, ctx, async (tx) => {
    const role = await getEffectiveWorkspaceRole(tx, ctx);
    const grants = workspaceGrants(role);
    if (!grants("workspace.events.read")) return null;
    const manage = grants("workspace.events.manage");
    const rows = await listWorkspaceEvents(tx, ctx, filters);
    const detail = editKey
      ? ((await listWorkspaceEvents(tx, ctx, {}, 200)).find(
          (row) => row.id === editKey,
        ) ?? null)
      : null;
    return {
      manage,
      rows,
      detail,
      trace: detail ? await eventTrace(tx, detail.id) : null,
      accessGrants: manage ? await workspaceAccessGrants(tx, ctx) : [],
      members: await listWorkspaceMembers(tx, ctx.workspaceId, ctx.organizationId),
    };
  });
  if (!data) return <ModuleNotice variant="denied" />;

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
  const names = new Map(
    data.members.map((member) => [
      member.userId,
      member.userId === identity.userId
        ? t("you")
        : t(`roles.${member.role as "owner"}`),
    ]),
  );
  const search = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
  const href = (event?: string) => {
    const next = new URLSearchParams(search);
    if (event) next.set("event", event);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
  const pendingGrants = data.accessGrants.filter(
    (grant) => grant.status === "pending" || grant.status === "approved",
  );

  const main = (
    <PageCanvas>
      <PageTitle
        icon={<Activity className="size-6" />}
        title={t("title")}
        description={t("description.workspace")}
      />
      {data.manage ? (
        <Card variant="panel" className="px-4 sm:px-6" data-testid="access-requests">
          <CardHeader className="px-0">
            <CardTitle>{ta("requestsTitle")}</CardTitle>
            <CardDescription>{ta("requestsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {pendingGrants.length === 0 ? (
              <p className="text-12 text-text-secondary">{ta("noRequests")}</p>
            ) : (
              <ItemGroup className="gap-2">
                {pendingGrants.map((grant) => (
                  <Item
                    key={grant.id}
                    variant={query.grant === grant.id ? "card" : "inset"}
                    size="sm"
                    data-testid="access-grant"
                    data-status={grant.status}
                  >
                    <ItemContent>
                      <ItemTitle>
                        {ta("requestedBy", {
                          who:
                            grant.requesterKind === "platform"
                              ? ta("platformSupport")
                              : (grant.requesterLabel ?? ta("partnerSupport")),
                        })}
                        <Badge variant={STATUS_BADGE[grant.status] ?? "neutral"}>
                          {ta(`status.${grant.status}`)}
                        </Badge>
                      </ItemTitle>
                      <ItemDescription>
                        {[
                          ta("reasonLine", {
                            reason: grant.reason,
                            reference: grant.reference,
                          }),
                          ta("eventsCount", { count: grant.eventIds.length }),
                          grant.status === "approved" && grant.expiresAt
                            ? ta("until", { date: when(grant.expiresAt) })
                            : ta("hours", { hours: grant.durationHours }),
                        ].join(" · ")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <AccessDecision
                        workspaceSlug={workspaceSlug}
                        grantId={grant.id}
                        status={grant.status}
                        maxHours={grant.durationHours}
                      />
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      ) : null}
      <EventFilters base={base} filters={filters} />
      <EventList rows={data.rows} href={(id) => href(id)} current={editKey} />
    </PageCanvas>
  );

  const detail = data.detail;
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
      {data.manage ? (
        <EventStatusButtons
          scope={{ level: "workspace", workspaceSlug }}
          eventId={detail.id}
          status={detail.status}
        />
      ) : null}
      <Card variant="surface" className="px-4">
        <CardHeader className="px-0">
          <CardTitle>{t("whatHappened")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <KeyValueList
            items={[
              {
                label: t("eventId"),
                value: <span className="text-12 font-mono break-all">{detail.id}</span>,
              },
              { label: t("type"), value: detail.type },
              { label: t("module"), value: detail.module },
              { label: t("occurredAt"), value: when(detail.occurredAt) },
            ]}
          />
          <pre
            className="bg-surface-inset rounded-inner text-12 text-text mt-3 max-h-72 overflow-auto p-3 font-mono break-all whitespace-pre-wrap"
            data-testid="event-panel-data"
          >
            {JSON.stringify(detail.data ?? {}, null, 2)}
          </pre>
        </CardContent>
      </Card>
      {data.trace ? <EventTraceCards trace={data.trace} names={names} /> : null}
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
