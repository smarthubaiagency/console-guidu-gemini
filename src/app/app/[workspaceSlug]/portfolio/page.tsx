import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  PRICE_DISPLAY_LABELS,
  STATUS_LABELS,
  VariantFields,
} from "@/modules/portfolio/components/fields";
import { PortfolioPermissions } from "@/modules/portfolio/manifest";
import { createPortfolioItemAction } from "@/modules/portfolio/server/actions";
import { listItems } from "@/modules/portfolio/server";
import {
  ITEM_TYPES,
  itemTypeLabel,
  listKinds,
  verticalLabel,
} from "@/modules/portfolio/verticals";

function verticalLabelFor(itemType: string, vertical: string): string {
  return vertical === "general"
    ? itemTypeLabel(itemType)
    : `${itemTypeLabel(itemType)} — ${verticalLabel(itemType, vertical)}`;
}

export const metadata: Metadata = { title: "Portfólio" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    type?: string;
    cursor?: string;
  }>;
}

const STATUSES = ["draft", "active", "inactive", "archived"] as const;

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

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="portfolio">
      <ModulePageHeader
        trail={["Módulos", "Portfólio"]}
        title="Portfólio"
        description="Produtos, serviços e ofertas do workspace, no formato do protocolo UCP. É o que o agente consulta no atendimento."
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
              placeholder="Buscar por título ou endereço"
              aria-label="Buscar no portfólio"
              className={`${inputClass} min-w-60 flex-1`}
            />
            <select
              name="status"
              defaultValue={statusFilter ?? ""}
              aria-label="Situação"
              className={inputClass}
            >
              <option value="">Todos (menos arquivados)</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              name="type"
              defaultValue={typeFilter ?? ""}
              aria-label="Categoria"
              className={inputClass}
            >
              <option value="">Todas as categorias</option>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {itemTypeLabel(t)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="border-border text-12 text-text rounded-lg border px-4 py-2 font-semibold"
            >
              Buscar
            </button>
          </form>

          {view.items.length === 0 ? (
            <p className="text-12 text-text-secondary">
              {search || statusFilter || typeFilter
                ? "Nenhum item encontrado."
                : "Sem dados: nenhum item ainda."}
            </p>
          ) : (
            <ul
              className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
              data-testid="portfolio-list"
            >
              {view.items.map((item) => {
                const prices = item.variants
                  .map((v) => v.priceAmount)
                  .filter((p): p is number => p !== null);
                const min = prices.length ? Math.min(...prices) : null;
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
                      {verticalLabelFor(item.itemType, item.vertical)} ·{" "}
                      {STATUS_LABELS[item.status]} ·{" "}
                      {item.priceDisplay === "quote"
                        ? "sob consulta"
                        : `${item.priceDisplay === "from" || prices.length > 1 ? "a partir de " : ""}${formatMoney(min)}`}{" "}
                      · {item.variants.length}{" "}
                      {item.variants.length === 1 ? "variante" : "variantes"}
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
              Mais itens
            </Link>
          ) : null}

          <section className={sectionClass}>
            <h2 className="text-14 text-text font-semibold">Novo item</h2>
            {view.readOnly ? (
              <p className="text-12 text-text-secondary">
                Assinatura suspensa: o portfólio fica só para consulta.
              </p>
            ) : view.canWrite ? (
              <ActionForm
                action={createPortfolioItemAction}
                submitLabel="Criar item"
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
                    Categoria
                    <select
                      name="kind"
                      defaultValue="product:general"
                      className={inputClass}
                    >
                      {listKinds().map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    Título
                    <input
                      name="title"
                      required
                      maxLength={200}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    Exibição do preço
                    <select
                      name="price_display"
                      defaultValue="price"
                      className={inputClass}
                    >
                      {Object.entries(PRICE_DISPLAY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${labelClass} sm:col-span-3`}>
                    Descrição
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
                  O item nasce como rascunho; os dados da categoria (por
                  exemplo, quartos de um imóvel ou a data de um evento) são
                  preenchidos na página do item. Hospedagem chega na próxima
                  etapa.
                </p>
              </ActionForm>
            ) : (
              <p className="text-12 text-text-secondary">
                Seu papel permite apenas consultar o portfólio.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
