import type { Metadata } from "next";
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
import { listLocations } from "@/core/locations/service";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import {
  formatMoney,
  FULFILLMENT_LABELS,
  PRICE_DISPLAY_LABELS,
  STATUS_LABELS,
  VariantFields,
} from "@/modules/portfolio/components/fields";
import { PortfolioPermissions } from "@/modules/portfolio/manifest";
import {
  addPortfolioVariantAction,
  updatePortfolioItemAction,
  updatePortfolioVariantAction,
} from "@/modules/portfolio/server/actions";
import { getItem, itemToUcp } from "@/modules/portfolio/server";
import { FULFILLMENT_METHODS, isUcpVisible } from "@/modules/portfolio/ucp";

export const metadata: Metadata = { title: "Item do portfólio" };

interface PageProps {
  params: Promise<{ workspaceSlug: string; itemId: string }>;
}

/** One Portfolio item (F5a): UCP fields, governance, variants and preview. */
export default async function PortfolioItemPage({ params }: PageProps) {
  const { workspaceSlug, itemId } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/portfolio/${itemId}`,
  );
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
  const view = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "portfolio",
      PortfolioPermissions.ITEMS_READ,
    );
    if (access.kind !== "ok") return access;
    try {
      return {
        kind: "ok" as const,
        item: await getItem(tx, context, itemId),
        locations: await listLocations(tx, context),
        canWrite:
          access.can(PortfolioPermissions.ITEMS_WRITE) && !access.readOnly,
      };
    } catch {
      return { kind: "missing" as const };
    }
  });
  if (view.kind === "missing") notFound();
  if (view.kind !== "ok") return <ModuleNotice variant={view.kind} />;
  const { item, locations, canWrite } = view;
  const ucp = itemToUcp(item);
  const visible = isUcpVisible(item);
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="itemId" value={item.id} />
    </>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="portfolio-item">
      <ModulePageHeader
        trail={["Módulos", "Portfólio", item.title]}
        title={item.title}
        description={`${STATUS_LABELS[item.status]} · ${item.variants.length} ${item.variants.length === 1 ? "variante" : "variantes"} · endereço /${item.handle}`}
        icon={<ShoppingBag className="h-5 w-5" />}
      />

      <fieldset disabled={!canWrite} className="space-y-6">
        <section className={sectionClass}>
          <h2 className="text-14 text-text font-semibold">Dados do item</h2>
          <ActionForm
            action={updatePortfolioItemAction}
            submitLabel="Salvar item"
            className="space-y-3"
            testId="edit-portfolio-item"
          >
            {hidden}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={`${labelClass} sm:col-span-2`}>
                Título
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={item.title}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Endereço (handle)
                <input
                  name="handle"
                  required
                  maxLength={200}
                  defaultValue={item.handle}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Situação
                <select
                  name="status"
                  defaultValue={item.status}
                  className={inputClass}
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Exibição do preço
                <select
                  name="price_display"
                  defaultValue={item.priceDisplay}
                  className={inputClass}
                >
                  {Object.entries(PRICE_DISPLAY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Visibilidade
                <select
                  name="visibility"
                  defaultValue={item.visibility}
                  className={inputClass}
                >
                  <option value="public">Pública</option>
                  <option value="internal">Interna</option>
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-3`}>
                Descrição
                <textarea
                  name="description_plain"
                  rows={3}
                  maxLength={10000}
                  defaultValue={item.description.plain ?? ""}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>
                Descrição em Markdown (opcional)
                <textarea
                  name="description_markdown"
                  rows={3}
                  maxLength={10000}
                  defaultValue={item.description.markdown ?? ""}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Categorias (uma por linha: valor | taxonomia)
                <textarea
                  name="categories"
                  rows={3}
                  placeholder={
                    "Vestuário > Camisetas | merchant\n212 | google_product_category"
                  }
                  defaultValue={item.categories
                    .map((c) => `${c.value} | ${c.taxonomy ?? "merchant"}`)
                    .join("\n")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Imagens (uma URL por linha: url | texto alternativo)
                <textarea
                  name="media"
                  rows={3}
                  defaultValue={item.media
                    .map(
                      (m) => `${m.url}${m.alt_text ? ` | ${m.alt_text}` : ""}`,
                    )
                    .join("\n")}
                  className={inputClass}
                />
                <span className="text-11 text-text-secondary">
                  Envio de arquivo: em breve, quando o Storage for definido nas
                  configurações da plataforma.
                </span>
              </label>
              <div className="space-y-2">
                <label className={labelClass}>
                  Tags (separadas por vírgula)
                  <input
                    name="tags"
                    defaultValue={item.tags.join(", ")}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Página do item (URL)
                  <input
                    name="url"
                    type="url"
                    defaultValue={item.url ?? ""}
                    className={inputClass}
                  />
                </label>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-12 text-text-subtle font-medium">
                  Como é entregue ou atendido
                </legend>
                {FULFILLMENT_METHODS.map((m) => (
                  <label key={m} className="text-12 text-text flex gap-2">
                    <input
                      type="checkbox"
                      name="fulfillment_methods"
                      value={m}
                      defaultChecked={item.fulfillmentMethods.includes(m)}
                    />
                    {FULFILLMENT_LABELS[m]}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-1 sm:col-span-2">
                <legend className="text-12 text-text-subtle font-medium">
                  Lojas onde está disponível
                </legend>
                {locations.length === 0 ? (
                  <p className="text-12 text-text-secondary">
                    Nenhuma loja cadastrada em Configurações › Lojas.
                  </p>
                ) : (
                  locations.map((l) => (
                    <label key={l.id} className="text-12 text-text flex gap-2">
                      <input
                        type="checkbox"
                        name="location_ids"
                        value={l.id}
                        defaultChecked={item.locationIds.includes(l.id)}
                      />
                      {l.name}
                    </label>
                  ))
                )}
              </fieldset>
            </div>

            <h3 className="text-12 text-text pt-2 font-semibold">
              Vitrine e agente de IA (uso interno; nunca sai pelo UCP)
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-12 text-text flex items-center gap-2">
                <input
                  type="checkbox"
                  name="ai_discovery_enabled"
                  defaultChecked={item.aiDiscoveryEnabled}
                />
                A IA pode sugerir este item
              </label>
              <label className="text-12 text-text flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_featured"
                  defaultChecked={item.isFeatured}
                />
                Destaque
              </label>
              <label className={labelClass}>
                Prioridade
                <input
                  name="priority"
                  type="number"
                  defaultValue={item.priority}
                  className={inputClass}
                />
              </label>
              <input
                type="hidden"
                name="featured_rank"
                value={item.featuredRank}
              />
              <label className={labelClass}>
                Palavras-chave para a IA
                <input
                  name="ai_keywords"
                  defaultValue={item.aiKeywords.join(", ")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Sinônimos
                <input
                  name="ai_aliases"
                  defaultValue={item.aiAliases.join(", ")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                A IA nunca deve dizer
                <input
                  name="ai_do_not_say"
                  defaultValue={item.aiDoNotSay.join(", ")}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>
                Regras de segurança para a IA
                <textarea
                  name="ai_safety_rules"
                  rows={2}
                  maxLength={2000}
                  defaultValue={item.aiSafetyRules ?? ""}
                  className={inputClass}
                />
              </label>
            </div>
          </ActionForm>
        </section>

        <section className={sectionClass}>
          <h2 className="text-14 text-text font-semibold">
            Variantes ({item.variants.length})
          </h2>
          <div className="divide-border divide-y">
            {item.variants.map((v, index) => (
              <div key={v.id} className="space-y-2 py-4" data-testid="variant">
                <p className="text-12 text-text-secondary">
                  <span className="text-text font-semibold">{v.title}</span> ·{" "}
                  {formatMoney(v.priceAmount, v.currency)}
                  {index === 0 ? " · destaque" : ""}
                </p>
                <ActionForm
                  action={updatePortfolioVariantAction}
                  submitLabel="Salvar variante"
                  className="space-y-3"
                >
                  {hidden}
                  <input type="hidden" name="variantId" value={v.id} />
                  <VariantFields variant={v} idPrefix={`variant-${index}`} />
                </ActionForm>
                {item.variants.length > 1 ? (
                  <ActionForm
                    action={updatePortfolioVariantAction}
                    submitLabel="Remover variante"
                    tone="neutral"
                  >
                    {hidden}
                    <input type="hidden" name="variantId" value={v.id} />
                    <input type="hidden" name="remove" value="1" />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </div>
          <h3 className="text-12 text-text pt-2 font-semibold">
            Nova variante
          </h3>
          <ActionForm
            action={addPortfolioVariantAction}
            submitLabel="Adicionar variante"
            className="space-y-3"
            testId="add-variant"
          >
            {hidden}
            <VariantFields idPrefix="new-variant" />
          </ActionForm>
        </section>
      </fieldset>

      <section className={sectionClass} data-testid="ucp-preview">
        <h2 className="text-14 text-text font-semibold">
          Prévia no protocolo UCP
        </h2>
        <p className="text-12 text-text-secondary">
          {visible
            ? "É assim que agentes compatíveis com o UCP veem este item."
            : item.priceDisplay === "quote"
              ? "Item sob consulta: não sai pelo UCP; só o agente do GUIDU oferece."
              : "Este item não sai pelo UCP enquanto não estiver ativo, público e liberado para a IA. Prévia do formato:"}
        </p>
        {ucp ? (
          <pre className="bg-surface-raised text-11 max-h-96 overflow-auto rounded-lg p-3">
            {JSON.stringify(ucp, null, 2)}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
