import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { RecordWorkbench } from "@/components/layout/workbench";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  type CustomerGuidSummaryDto,
  CustomerGuidFilters,
  GUID_STATUSES,
  loadCustomerGuidsView,
} from "@/core/ai/customer-guids";
import { aiPolicy } from "@/core/ai/catalog";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { GuidEditorPanel } from "./guid-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("guids.metaTitle") };
}

const BASE = "/admin/ai/guids";

type SearchParams = Partial<
  Record<"q" | "customer" | "status" | "edit", string>
>;

const STATUS_BADGE = {
  active: "default",
  paused: "outline",
  draft: "secondary",
} as const;

/**
 * GUIDS of the partner's customers (A3c, especificação §5.2 and §6): list
 * with search and filters by customer and status, the editor in the
 * drawer (ADR 0015) at `?edit=<id>`. Support reads; owner and admin edit.
 */
export default async function PartnerAiGuidsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  if (!isModuleTechnicallyAvailable("ai-agents")) notFound();
  const { identity, partner, membership } =
    await requirePartnerConsolePage(BASE);
  const grants = partnerGrants(membership.role);
  if (!grants("partner.ai_agents.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("partner.ai_agents.manage");
  const params = await searchParams;
  const filters = CustomerGuidFilters.parse({
    q: params.q || undefined,
    customer: params.customer || undefined,
    status: params.status || undefined,
  });
  const editKey = params.edit || null;
  const actor = {
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership.role,
  };
  const { view, policy } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      view: await loadCustomerGuidsView(tx, actor, filters, editKey),
      policy: await aiPolicy(tx),
    }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("aiConsole");
  const format = await getFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short" });

  // The list's address with the filters, plus the record to open.
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
  const href = (edit?: string) => {
    const next = new URLSearchParams(query);
    if (edit) next.set("edit", edit);
    const search = next.toString();
    return search ? `${BASE}?${search}` : BASE;
  };

  const details = (guid: CustomerGuidSummaryDto) =>
    [
      guid.customerName,
      guid.model ? t("guids.model", { model: guid.model }) : t("guids.noModel"),
      t(`guids.keyState.${guid.keyState}`),
      guid.customized ? t("guids.customized") : null,
      guid.changedByPartner
        ? t("guids.changedByYou", { date: date(guid.updatedAt) })
        : t("guids.updated", { date: date(guid.updatedAt) }),
    ]
      .filter(Boolean)
      .join(" · ");

  const statusLabel = (status: string) =>
    (GUID_STATUSES as readonly string[]).includes(status)
      ? t(`guids.status.${status}`)
      : status;

  const opened = view.opened;
  const panel = opened ? (
    <GuidEditorPanel
      key={opened.id}
      guid={opened}
      canManage={canManage}
      policy={policy}
      summary={
        <div className="space-y-1">
          <p className="text-12 text-text-secondary" data-testid="guid-state">
            {statusLabel(opened.status)} · {details(opened)}
          </p>
          {opened.missing.length > 0 ? (
            <p
              className="text-12 text-text-secondary"
              data-testid="guid-missing"
            >
              {t("guids.missing", {
                fields: opened.missing
                  .map((path) => t(`editor.fields.${path.split(".")[1]}`))
                  .join(", "),
              })}
            </p>
          ) : null}
        </div>
      }
    />
  ) : null;

  const main = (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="partner-ai-guids">
      <ModulePageHeader
        title={t("guids.title")}
        description={t("guids.description")}
        icon={<Bot className="h-5 w-5" />}
      />
      <form
        method="get"
        action={BASE}
        className="border-card-border bg-surface-card grid gap-3 rounded-xl border p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4"
        data-testid="guid-filters"
      >
        <div className="space-y-1">
          <Label htmlFor="guids-q" className="text-12">
            {t("guids.search")}
          </Label>
          <Input
            id="guids-q"
            name="q"
            type="search"
            maxLength={80}
            defaultValue={filters.q ?? ""}
            placeholder={t("guids.searchPlaceholder")}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="guids-customer" className="text-12">
            {t("guids.customer")}
          </Label>
          <NativeSelect
            id="guids-customer"
            name="customer"
            defaultValue={filters.customer ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">
              {t("guids.allCustomers")}
            </NativeSelectOption>
            {[...view.customers].map(([id, name]) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="guids-status" className="text-12">
            {t("guids.statusFilter")}
          </Label>
          <NativeSelect
            id="guids-status"
            name="status"
            defaultValue={filters.status ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="">
              {t("guids.allStatuses")}
            </NativeSelectOption>
            {GUID_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {t(`guids.status.${status}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">{t("guids.filter")}</Button>
          {query.size > 0 ? (
            <Button asChild variant="outline">
              <Link href={BASE}>{t("guids.clear")}</Link>
            </Button>
          ) : null}
        </div>
      </form>
      <section className="space-y-2">
        <h2 className="text-14 text-text font-semibold">
          {t("guids.list", { count: view.guids.length })}
        </h2>
        <ul
          className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
          data-testid="guid-list"
        >
          {view.guids.map((guid) => (
            <li
              key={guid.id}
              className="flex flex-wrap items-center justify-between gap-2 p-4"
              data-testid="guid-row"
            >
              <div className="min-w-0 space-y-1">
                <Link
                  href={href(guid.id)}
                  scroll={false}
                  aria-current={guid.id === editKey ? "true" : undefined}
                  className="text-14 text-text font-medium hover:underline"
                >
                  {guid.name ?? t("guids.unnamed")}
                </Link>
                <p className="text-12 text-text-secondary">{details(guid)}</p>
              </div>
              <Badge
                variant={
                  STATUS_BADGE[guid.status as keyof typeof STATUS_BADGE] ??
                  "secondary"
                }
              >
                {statusLabel(guid.status)}
              </Badge>
            </li>
          ))}
          {view.guids.length === 0 ? (
            <li className="text-12 text-text-secondary p-4">
              {t("guids.empty")}
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("guids.panelLabel")}
      closeHref={href()}
      editKey={editKey}
      defaultPanelSize="wide"
    />
  );
}
