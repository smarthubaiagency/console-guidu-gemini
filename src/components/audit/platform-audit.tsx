"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Filter,
  Info,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  UserSearch,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { WorkbenchLayout, WorkbenchPanel } from "@/components/layout/workbench";
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
  ItemContent,
  ItemDescription,
  ItemMedia,
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
import {
  AUDIT_ORIGINS,
  AUDIT_RESULTS,
  type AuditFilterOptions,
  auditSearchParams,
  EMPTY_AUDIT_FILTERS,
  type PlatformAuditEvent,
  type PlatformAuditFilters,
  type PlatformAuditPage,
} from "@/core/audit/platform-filters";
import type { AuditOrigin, AuditResult } from "@/core/audit/record";

const PATH = "/platform/audit";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_PREFIX = /^[a-z0-9_.]{1,80}$/;
const DATE_TIME = { dateStyle: "short", timeStyle: "medium" } as const;

const RESULT_BADGE: Record<AuditResult, "success" | "warning" | "danger"> = {
  success: "success",
  denied: "warning",
  error: "danger",
};

type Draft = Readonly<{
  partner: string;
  organization: string;
  workspace: string;
  action: string;
  result: string;
  origin: string;
  actor: string;
  from: string;
  to: string;
}>;

function toDraft(filters: PlatformAuditFilters): Draft {
  return {
    partner: filters.partnerId ?? "",
    organization: filters.organizationId ?? "",
    workspace: filters.workspaceId ?? "",
    action: filters.action ?? "",
    result: filters.result ?? "",
    origin: filters.origin ?? "",
    actor: filters.actorUserId ?? "",
    from: filters.from ?? "",
    to: filters.to ?? "",
  };
}

function toFilters(draft: Draft): PlatformAuditFilters {
  const value = (raw: string) => (raw.trim() === "" ? null : raw.trim());
  return {
    partnerId: value(draft.partner),
    organizationId: value(draft.organization),
    workspaceId: value(draft.workspace),
    action: value(draft.action.toLowerCase()),
    result: value(draft.result) as AuditResult | null,
    origin: value(draft.origin) as AuditOrigin | null,
    actorUserId: value(draft.actor.toLowerCase()),
    from: value(draft.from),
    to: value(draft.to),
  };
}

function metadataValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** The first second after the event: its page of security events starts with it. */
function securityHref(event: PlatformAuditEvent): string {
  const after = new Date(Date.parse(event.occurredAt) + 1000).toISOString();
  return `/platform/settings/security/events?before=${encodeURIComponent(after)}`;
}

/**
 * Plataforma › Auditoria (AUD1): filters above, the page of events and the
 * detail of the chosen event in the internal drawer (ADR 0015). Read only;
 * the filters live in the address bar, so a filtered view can be shared.
 */
export function PlatformAudit({
  page,
  options,
  filters,
  paged,
  billingOnly,
  securityLinks,
  initialEventId,
}: Readonly<{
  page: PlatformAuditPage;
  options: AuditFilterOptions;
  filters: PlatformAuditFilters;
  /** True when this is not the first page. */
  paged: boolean;
  billingOnly: boolean;
  /** The viewer may open the security events (CF5a). */
  securityLinks: boolean;
  initialEventId: string | null;
}>) {
  const t = useTranslations("platformAudit");
  const format = useFormatter();
  const router = useRouter();
  const { showStatus } = useStatus();
  const [draft, setDraft] = useState<Draft>(() => toDraft(filters));
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    page.events.some((e) => e.id === initialEventId) ? initialEventId : null,
  );
  const selected = page.events.find((e) => e.id === selectedId) ?? null;

  const actionInvalid =
    draft.action.trim() !== "" &&
    !ACTION_PREFIX.test(draft.action.trim().toLowerCase());
  const actorInvalid =
    draft.actor.trim() !== "" && !UUID.test(draft.actor.trim());

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const go = (next: PlatformAuditFilters, cursor?: string | null) => {
    const query = auditSearchParams(next, cursor);
    router.push(query ? `${PATH}?${query}` : PATH);
  };

  const apply = () => {
    if (actionInvalid || actorInvalid) {
      showStatus({ type: "oops", title: t("filters.fixFields") });
      return;
    }
    if (draft.from && draft.to && draft.to < draft.from) {
      showStatus({
        type: "oops",
        title: t("filters.periodInvalid"),
        message: t("filters.periodInvalidDetails"),
      });
      return;
    }
    setSelectedId(null);
    go(toFilters(draft));
  };

  const clear = () => {
    setDraft(toDraft(EMPTY_AUDIT_FILTERS));
    setSelectedId(null);
    go(EMPTY_AUDIT_FILTERS);
  };

  const select = (id: string | null) => {
    setSelectedId(id);
    // The open event goes to the address bar, without a new server render.
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("event", id);
    else url.searchParams.delete("event");
    window.history.replaceState(null, "", url);
  };

  const filterByActor = (actorId: string) => {
    const next = { ...toFilters(draft), actorUserId: actorId };
    setDraft(toDraft(next));
    setSelectedId(null);
    go(next);
  };

  const actorLabel = (event: PlatformAuditEvent) => {
    if (!event.actorUserId) return t(`principal.${event.actorPrincipalType}`);
    return (
      event.actorName ?? t("list.user", { id: event.actorUserId.slice(0, 8) })
    );
  };
  const whereLabel = (event: PlatformAuditEvent) =>
    event.organizationName ??
    event.partnerName ??
    (event.organizationId
      ? event.organizationId.slice(0, 8)
      : t("list.platform"));

  const field = (
    id: keyof Draft,
    label: string,
    control: React.ReactNode,
    error?: string | null,
  ) => (
    <div className="grid content-start gap-2">
      <Label htmlFor={`audit-${id}`}>{label}</Label>
      {control}
      {error ? (
        <p className="text-12 text-danger-text" id={`audit-${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );

  const main = (
    <PageCanvas className="p-4 md:p-6">
      <PageTitle
        icon={<ScrollText className="size-6" />}
        title={t("title")}
        description={billingOnly ? t("descriptionBilling") : t("description")}
        actions={
          billingOnly ? (
            <Badge variant="info" data-testid="audit-billing-only">
              {t("billingOnly")}
            </Badge>
          ) : null
        }
      />

      <Card variant="surface" data-testid="audit-filters">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-4" />
            {t("filters.title")}
          </CardTitle>
          <CardDescription>{t("filters.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {field(
              "partner",
              t("filters.partner"),
              <NativeSelect
                id="audit-partner"
                className="w-full"
                value={draft.partner}
                onChange={(e) => set("partner")(e.target.value)}
              >
                <NativeSelectOption value="">
                  {t("filters.any")}
                </NativeSelectOption>
                {options.partners.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>,
            )}
            {field(
              "organization",
              t("filters.organization"),
              <NativeSelect
                id="audit-organization"
                className="w-full"
                value={draft.organization}
                onChange={(e) => set("organization")(e.target.value)}
              >
                <NativeSelectOption value="">
                  {t("filters.any")}
                </NativeSelectOption>
                {options.organizations.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>,
            )}
            {field(
              "workspace",
              t("filters.workspace"),
              <NativeSelect
                id="audit-workspace"
                className="w-full"
                value={draft.workspace}
                onChange={(e) => set("workspace")(e.target.value)}
              >
                <NativeSelectOption value="">
                  {t("filters.any")}
                </NativeSelectOption>
                {options.workspaces.map((w) => (
                  <NativeSelectOption key={w.id} value={w.id}>
                    {`${w.organizationName} › ${w.name}`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>,
            )}
            {field(
              "action",
              t("filters.action"),
              <Input
                id="audit-action"
                value={draft.action}
                placeholder={t("filters.actionPlaceholder")}
                aria-invalid={actionInvalid || undefined}
                aria-describedby={
                  actionInvalid ? "audit-action-error" : undefined
                }
                onChange={(e) => set("action")(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") apply();
                }}
              />,
              actionInvalid ? t("filters.actionInvalid") : null,
            )}
            {field(
              "result",
              t("filters.result"),
              <NativeSelect
                id="audit-result"
                className="w-full"
                value={draft.result}
                onChange={(e) => set("result")(e.target.value)}
              >
                <NativeSelectOption value="">
                  {t("filters.any")}
                </NativeSelectOption>
                {AUDIT_RESULTS.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {t(`result.${r}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>,
            )}
            {field(
              "origin",
              t("filters.origin"),
              <NativeSelect
                id="audit-origin"
                className="w-full"
                value={draft.origin}
                onChange={(e) => set("origin")(e.target.value)}
              >
                <NativeSelectOption value="">
                  {t("filters.any")}
                </NativeSelectOption>
                {AUDIT_ORIGINS.map((o) => (
                  <NativeSelectOption key={o} value={o}>
                    {t(`origin.${o}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>,
            )}
            {field(
              "actor",
              t("filters.actor"),
              <Input
                id="audit-actor"
                value={draft.actor}
                placeholder={t("filters.actorPlaceholder")}
                aria-invalid={actorInvalid || undefined}
                aria-describedby={
                  actorInvalid ? "audit-actor-error" : undefined
                }
                onChange={(e) => set("actor")(e.target.value)}
              />,
              actorInvalid ? t("filters.actorInvalid") : null,
            )}
            {field(
              "from",
              t("filters.from"),
              <Input
                id="audit-from"
                type="date"
                value={draft.from}
                onChange={(e) => set("from")(e.target.value)}
              />,
            )}
            {field(
              "to",
              t("filters.to"),
              <Input
                id="audit-to"
                type="date"
                value={draft.to}
                onChange={(e) => set("to")(e.target.value)}
              />,
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={clear} data-testid="audit-clear">
              <RotateCcw />
              {t("filters.clear")}
            </Button>
            <Button onClick={apply} data-testid="audit-apply">
              <Search />
              {t("filters.apply")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card variant="surface" data-testid="audit-list">
        <CardHeader>
          <CardTitle>{t("list.title")}</CardTitle>
          <CardDescription>
            {t("list.description", { count: page.events.length })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {page.events.length === 0 ? (
            <Empty
              className="bg-surface-inset rounded-inner"
              data-testid="audit-empty"
            >
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScrollText />
                </EmptyMedia>
                <EmptyTitle>{t("empty.title")}</EmptyTitle>
                <EmptyDescription>{t("empty.description")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table variant="soft" data-testid="audit-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("list.columns.when")}</TableHead>
                  <TableHead>{t("list.columns.event")}</TableHead>
                  <TableHead>{t("list.columns.where")}</TableHead>
                  <TableHead>{t("list.columns.actor")}</TableHead>
                  <TableHead>{t("list.columns.result")}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t("list.open")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.events.map((event) => (
                  <TableRow
                    key={event.id}
                    data-testid="audit-event"
                    data-action={event.action}
                    aria-selected={event.id === selectedId || undefined}
                    className="cursor-pointer"
                    onClick={() => select(event.id)}
                  >
                    <TableCell className="text-text-secondary whitespace-nowrap">
                      {format.dateTime(new Date(event.occurredAt), DATE_TIME)}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-text font-mono">
                          {event.action}
                        </span>
                        {event.isSecurity ? (
                          <Badge variant="info">
                            <ShieldCheck />
                            {t("list.security")}
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {whereLabel(event)}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {actorLabel(event)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={RESULT_BADGE[event.result]}>
                        {t(`result.${event.result}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="audit-event-open"
                        onClick={(e) => {
                          e.stopPropagation();
                          select(event.id);
                        }}
                      >
                        {t("list.open")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {paged || page.next ? (
            <div className="flex flex-wrap gap-2">
              {paged ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`${PATH}?${auditSearchParams(filters)}`}
                    data-testid="audit-newest"
                  >
                    {t("list.newest")}
                  </Link>
                </Button>
              ) : null}
              {page.next ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`${PATH}?${auditSearchParams(filters, page.next)}`}
                    data-testid="audit-older"
                  >
                    {t("list.older")}
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </PageCanvas>
  );

  return (
    <WorkbenchLayout
      main={main}
      panelLabel={t("detail.label")}
      panelOpen={selected !== null}
      onPanelOpenChange={(open) => {
        if (!open) select(null);
      }}
      panel={
        selected ? (
          <WorkbenchPanel
            title={selected.action}
            description={format.dateTime(
              new Date(selected.occurredAt),
              DATE_TIME,
            )}
          >
            <div className="flex flex-col gap-4" data-testid="audit-detail">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={RESULT_BADGE[selected.result]}>
                  {t(`result.${selected.result}`)}
                </Badge>
                <Badge variant="neutral">
                  {t.has(`origin.${selected.origin}`)
                    ? t(`origin.${selected.origin}`)
                    : selected.origin}
                </Badge>
                {selected.isSecurity ? (
                  <Badge variant="info">
                    <ShieldCheck />
                    {t("list.security")}
                  </Badge>
                ) : null}
              </div>

              <KeyValueList
                items={[
                  { label: t("detail.id"), value: <Mono>{selected.id}</Mono> },
                  {
                    label: t("detail.occurredAt"),
                    value: <Mono>{selected.occurredAt}</Mono>,
                  },
                  {
                    label: t("detail.action"),
                    value: <Mono>{selected.action}</Mono>,
                  },
                  { label: t("detail.actor"), value: actorLabel(selected) },
                  ...(selected.actorUserId
                    ? [
                        {
                          label: t("detail.actorId"),
                          value: <Mono>{selected.actorUserId}</Mono>,
                        },
                      ]
                    : []),
                  {
                    label: t("detail.principal"),
                    value: t(`principal.${selected.actorPrincipalType}`),
                  },
                  ...(selected.representedUserId
                    ? [
                        {
                          label: t("detail.represented"),
                          value: <Mono>{selected.representedUserId}</Mono>,
                        },
                      ]
                    : []),
                  {
                    label: t("detail.partner"),
                    value: selected.partnerName ?? selected.partnerId ?? "—",
                  },
                  {
                    label: t("detail.organization"),
                    value:
                      selected.organizationName ??
                      selected.organizationId ??
                      "—",
                  },
                  {
                    label: t("detail.workspace"),
                    value:
                      selected.workspaceName ?? selected.workspaceId ?? "—",
                  },
                  {
                    label: t("detail.resource"),
                    value: (
                      <Mono>
                        {selected.resourceId
                          ? `${selected.resourceType} · ${selected.resourceId}`
                          : selected.resourceType}
                      </Mono>
                    ),
                  },
                  ...(selected.clientId
                    ? [
                        {
                          label: t("detail.client"),
                          value: <Mono>{selected.clientId}</Mono>,
                        },
                      ]
                    : []),
                  ...(selected.requestId
                    ? [
                        {
                          label: t("detail.request"),
                          value: <Mono>{selected.requestId}</Mono>,
                        },
                      ]
                    : []),
                ]}
              />

              <Card
                variant="inset"
                className="px-4"
                data-testid="audit-metadata"
              >
                <CardTitle className="text-14">
                  {t("detail.metadata")}
                </CardTitle>
                {Object.keys(selected.metadata).length === 0 ? (
                  <p className="text-12 text-text-secondary">
                    {t("detail.noMetadata")}
                  </p>
                ) : (
                  <KeyValueList
                    items={Object.entries(selected.metadata).map(
                      ([key, value]) => ({
                        label: key,
                        value: <Mono>{metadataValue(value)}</Mono>,
                      }),
                    )}
                  />
                )}
              </Card>

              <Item variant="inset" size="sm" role="note">
                <ItemMedia>
                  <Info className="text-info-text size-4" />
                </ItemMedia>
                <ItemContent>
                  <ItemDescription>{t("detail.allowlist")}</ItemDescription>
                </ItemContent>
              </Item>

              <div className="flex flex-wrap gap-2">
                {selected.actorUserId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="audit-filter-actor"
                    onClick={() => filterByActor(selected.actorUserId!)}
                  >
                    <UserSearch />
                    {t("detail.filterActor")}
                  </Button>
                ) : null}
                {selected.isSecurity && securityLinks ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={securityHref(selected)}
                      data-testid="audit-security-link"
                    >
                      <ShieldCheck />
                      {t("detail.securityLink")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </WorkbenchPanel>
        ) : null
      }
    />
  );
}

function Mono({ children }: Readonly<{ children: React.ReactNode }>) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}
