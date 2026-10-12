import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ShoppingBag } from "lucide-react";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import {
  formatMoney,
  ITEM_STATUSES,
  labelOf,
  PRICE_DISPLAYS,
  VariantFields,
} from "@/modules/portfolio/components/fields";
import { PortfolioPermissions } from "@/modules/portfolio/manifest";
import { createPortfolioItemAction } from "@/modules/portfolio/server/actions";
import { listItems } from "@/modules/portfolio/server";
import {
  ITEM_TYPES,
  translatedItemTypeLabel,
  translatedKindLabel,
  translatedKinds,
} from "@/modules/portfolio/verticals";

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
  }>;
}

const STATUSES = ITEM_STATUSES;

/** Items of the Portfolio (F5a): search, status filter and creation. */
export default async function PortfolioPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug } = await params;
  const { q, status, type, cursor } = await searchParams;
  const identity = await requireUserPage(`/app/${workspaceSlug}/portfolio`);
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch {
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
    return {
      kind: "ok" as const,
      ...page,
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
            const amounts = item.variants
              .map((v) => v.priceAmount)
              .filter((p): p is number => p !== null);
            const min = amounts.length ? Math.min(...amounts) : null;
            if (item.priceDisplay === "quote") return t("money.quote");
            const price = await formatMoney(min);
            return item.priceDisplay === "from" || amounts.length > 1
              ? t("list.fromPrice", { price })
              : price;
          }),
        )
      : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="portfolio">
      <ModulePageHeader
        trail={[t("trailModules"), t("list.title")]}
        title={t("list.title")}
        description={t("list.description")}
        icon={<ShoppingBag className="h-5 w-5" />}
      />
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : (
        <>
          <form method="get" className="flex flex-wrap gap-2" role="search">
            <input
              name="q"
              defaultValue={search}
              maxLength={100}
              placeholder={t("list.searchPlaceholder")}
              aria-label={t("list.searchLabel")}
              className={`${inputClass} min-w-60 flex-1`}
            />
            <select
              name="status"
              defaultValue={statusFilter ?? ""}
              aria-label={t("list.statusLabel")}
              className={inputClass}
            >
              <option value="">{t("list.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labelOf(t, "status", s)}
                </option>
              ))}
            </select>
            <select
              name="type"
              defaultValue={typeFilter ?? ""}
              aria-label={t("list.typeLabel")}
              className={inputClass}
            >
              <option value="">{t("list.allTypes")}</option>
              {ITEM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {translatedItemTypeLabel(t, type)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="border-border text-12 text-text rounded-lg border px-4 py-2 font-semibold"
            >
              {t("list.search")}
            </button>
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
                      href={`${base}/${item.id}`}
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

          <section className={sectionClass}>
            <h2 className="text-14 text-text font-semibold">
              {t("list.newItem")}
            </h2>
            {view.readOnly ? (
              <p className="text-12 text-text-secondary">
                {t("list.readOnly")}
              </p>
            ) : view.canWrite ? (
              <ActionForm
                action={createPortfolioItemAction}
                submitLabel={t("list.create")}
                className="space-y-3"
                testId="create-portfolio-item"
              >
                <input
                  type="hidden"
                  name="workspaceSlug"
                  value={workspaceSlug}
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={labelClass}>
                    {t("form.kind")}
                    <select
                      name="kind"
                      defaultValue="product:general"
                      className={inputClass}
                    >
                      {translatedKinds(t).map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    {t("form.title")}
                    <input
                      name="title"
                      required
                      maxLength={200}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("form.priceDisplay")}
                    <select
                      name="price_display"
                      defaultValue="price"
                      className={inputClass}
                    >
                      {PRICE_DISPLAYS.map((k) => (
                        <option key={k} value={k}>
                          {labelOf(t, "priceDisplay", k)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${labelClass} sm:col-span-3`}>
                    {t("form.description")}
                    <textarea
                      name="description_plain"
                      rows={2}
                      maxLength={10000}
                      className={inputClass}
                    />
                  </label>
                </div>
                <VariantFields idPrefix="new" />
                <p className="text-11 text-text-secondary">
                  {t("list.createHint")}
                </p>
              </ActionForm>
            ) : (
              <p className="text-12 text-text-secondary">
                {t("list.viewOnly")}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
