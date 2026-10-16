import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus, ShoppingBag } from "lucide-react";

import { RecordWorkbench, WorkbenchPanel } from "@/components/layout/workbench";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUserPage } from "@/core/auth/page-guard";
import { listLocations } from "@/core/locations/service";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import {
  formatMoney,
  ITEM_STATUSES,
  labelOf,
} from "@/modules/portfolio/components/fields";
import { PortfolioPermissions } from "@/modules/portfolio/manifest";
import { getItem, listItems } from "@/modules/portfolio/server";
import {
  ITEM_TYPES,
  translatedItemTypeLabel,
  translatedKindLabel,
} from "@/modules/portfolio/verticals";

import { itemSummary, PortfolioItemEditor } from "./item-editor";
import { NewItemForm } from "./new-item-form";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portfolio");
  return { title: t("metadata.list") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    type?: string;
    cursor?: string;
    edit?: string;
  }>;
}

const STATUSES = ITEM_STATUSES;

/**
 * Items of the Portfolio (F5a): search and filters. Creating and editing
 * open in the wide internal drawer (ADR 0015) at `?edit=new` or
 * `?edit=<id>`.
 */
export default async function PortfolioPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug } = await params;
  const { q, status, type, cursor, edit } = await searchParams;
  const editKey = typeof edit === "string" && edit ? edit : null;
  const identity = await requireUserPage(`/app/${workspaceSlug}/portfolio`);
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
  const search = typeof q === "string" ? q.slice(0, 100) : "";
  const statusFilter = STATUSES.find((s) => s === status);
  const typeFilter = ITEM_TYPES.find((t) => t === type);

  const view = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "portfolio",
      PortfolioPermissions.ITEMS_READ,
    );
    if (access.kind !== "ok") return access;
    const page = await listItems(tx, context, {
      search: search || undefined,
      status: statusFilter,
      item_type: typeFilter,
      cursor: typeof cursor === "string" ? cursor : undefined,
      limit: 50,
    });
    let editing = null;
    if (editKey && editKey !== "new") {
      try {
        editing = {
          item: await getItem(tx, context, editKey),
          locations: await listLocations(tx, context),
        };
      } catch {
        editing = null;
      }
    }
    return {
      kind: "ok" as const,
      ...page,
      editing,
      canWrite: access.can(PortfolioPermissions.ITEMS_WRITE),
      readOnly: access.readOnly,
    };
  });
  if (view.kind === "missing") notFound();
  const base = `/app/${workspaceSlug}/portfolio`;
  const t = await getTranslations("portfolio");
  const prices =
    view.kind === "ok"
      ? await Promise.all(
          view.items.map(async (item) => {
            const priced = item.variants.filter(
              (v): v is typeof v & { priceAmount: number } =>
                v.priceAmount !== null,
            );
            const amounts = priced.map((v) => v.priceAmount);
            const cheapest = priced.reduce<(typeof priced)[number] | null>(
              (low, v) => (!low || v.priceAmount < low.priceAmount ? v : low),
              null,
            );
            if (item.priceDisplay === "quote") return t("money.quote");
            const price = await formatMoney(
              cheapest?.priceAmount ?? null,
              cheapest?.currency,
            );
            return item.priceDisplay === "from" || amounts.length > 1
              ? t("list.fromPrice", { price })
              : price;
          }),
        )
      : [];

  const canEdit = view.kind === "ok" && view.canWrite && !view.readOnly;
  // Links keep the search, the filters and the page of the list.
  const listQuery = {
    ...(search ? { q: search } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(typeof cursor === "string" && cursor ? { cursor } : {}),
  };
  const hrefWith = (extra: Record<string, string>) => {
    const query = new URLSearchParams({ ...listQuery, ...extra }).toString();
    return query ? `${base}?${query}` : base;
  };

  let panel: React.ReactNode = null;
  if (editKey === "new" && canEdit) {
    panel = (
      <WorkbenchPanel title={t("list.newItem")}>
        <NewItemForm workspaceSlug={workspaceSlug} />
        <p className="text-11 text-text-secondary mt-3">
          {t("list.createHint")}
        </p>
      </WorkbenchPanel>
    );
  } else if (view.kind === "ok" && view.editing) {
    const { item, locations } = view.editing;
    panel = (
      <WorkbenchPanel title={item.title} description={await itemSummary(item)}>
        <PortfolioItemEditor
          key={item.id}
          workspaceSlug={workspaceSlug}
          item={item}
          locations={locations}
          canWrite={canEdit}
        />
      </WorkbenchPanel>
    );
  }

  const main = (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="portfolio">
      <ModulePageHeader
        title={t("list.title")}
        description={t("list.description")}
        icon={<ShoppingBag className="h-5 w-5" />}
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={hrefWith({ edit: "new" })} scroll={false}>
                <Plus />
                {t("list.newItem")}
              </Link>
            </Button>
          ) : null
        }
      />
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : (
        <>
          <form method="get" className="flex flex-wrap gap-2" role="search">
            <Input
              name="q"
              defaultValue={search}
              maxLength={100}
              placeholder={t("list.searchPlaceholder")}
              aria-label={t("list.searchLabel")}
              className="min-w-60 flex-1"
            />
            <NativeSelect
              name="status"
              defaultValue={statusFilter ?? ""}
              aria-label={t("list.statusLabel")}
            >
              <NativeSelectOption value="">
                {t("list.allStatuses")}
              </NativeSelectOption>
              {STATUSES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {labelOf(t, "status", s)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              name="type"
              defaultValue={typeFilter ?? ""}
              aria-label={t("list.typeLabel")}
            >
              <NativeSelectOption value="">
                {t("list.allTypes")}
              </NativeSelectOption>
              {ITEM_TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {translatedItemTypeLabel(t, type)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button type="submit" variant="outline">
              {t("list.search")}
            </Button>
          </form>

          {view.items.length === 0 ? (
            <p className="text-12 text-text-secondary">
              {search || statusFilter || typeFilter
                ? t("list.noResults")
                : t("list.empty")}
            </p>
          ) : (
            <ul
              className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
              data-testid="portfolio-list"
            >
              {view.items.map((item, index) => {
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-4"
                  >
                    <Link
                      href={hrefWith({ edit: item.id })}
                      scroll={false}
                      aria-current={item.id === editKey ? "true" : undefined}
                      className="text-14 text-text font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <span className="text-12 text-text-secondary">
                      {translatedKindLabel(t, item.itemType, item.vertical)} ·{" "}
                      {labelOf(t, "status", item.status)} · {prices[index]} ·{" "}
                      {t("list.variants", { count: item.variants.length })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {view.nextCursor ? (
            <Link
              href={`${base}?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(statusFilter ? { status: statusFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}), cursor: view.nextCursor })}`}
              className="text-12 text-primary font-semibold"
            >
              {t("list.more")}
            </Link>
          ) : null}

          {view.readOnly ? (
            <p className="text-12 text-text-secondary">{t("list.readOnly")}</p>
          ) : !view.canWrite ? (
            <p className="text-12 text-text-secondary">{t("list.viewOnly")}</p>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("item.panelLabel")}
      closeHref={hrefWith({})}
      editKey={editKey}
      defaultPanelSize="wide"
    />
  );
}
