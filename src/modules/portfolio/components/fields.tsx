import { inputClass, labelClass } from "@/components/partners/action-form";

import { AVAILABILITY_STATUSES, SALE_UNITS } from "../ucp";
import type { LodgingView, VariantView } from "../server/services/items";
import { fieldsFor, formValue, getPath } from "../verticals";

/** Shared labels and form fields of the Portfolio screens (F5a). */

export const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  inactive: "Inativo",
  archived: "Arquivado",
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  in_stock: "Disponível",
  backorder: "Sob encomenda",
  preorder: "Pré-venda",
  out_of_stock: "Esgotado",
  discontinued: "Descontinuado",
};

export const PRICE_DISPLAY_LABELS: Record<string, string> = {
  price: "Preço normal",
  from: "A partir de",
  quote: "Sob consulta (só o agente oferece)",
};

export const FULFILLMENT_LABELS: Record<string, string> = {
  shipping: "Entrega",
  pickup: "No local / retirada",
  digital: "Online",
  on_site: "No endereço do cliente",
};

/** "4990" -> "49,90" for the inputs. */
export function moneyInput(amount: number | null): string {
  return amount === null ? "" : (amount / 100).toFixed(2).replace(".", ",");
}

export function formatMoney(amount: number | null, currency = "BRL"): string {
  if (amount === null) return "sob consulta";
  return (amount / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency,
  });
}

/**
 * Fields of a variant (UCP Variant plus internal stock). In lodging (F5c)
 * a variant is the nightly price of one accommodation type under one rate
 * plan, chosen instead of the sale unit and the free options.
 */
export function VariantFields({
  variant,
  idPrefix,
  lodging,
}: Readonly<{
  variant?: VariantView;
  idPrefix: string;
  lodging?: LodgingView | null;
}>) {
  const unit = variant?.quantityUnit?.unit ?? "C62";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {lodging ? (
        <>
          <input type="hidden" name="lodging" value="1" />
          <label className={labelClass}>
            Acomodação
            <select
              name="accommodation_type_id"
              defaultValue={
                variant?.accommodationTypeId ??
                lodging.accommodationTypes[0]?.id ??
                ""
              }
              className={inputClass}
            >
              <option value="">—</option>
              {lodging.accommodationTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Tarifa
            <select
              name="rate_plan_id"
              defaultValue={
                variant?.ratePlanId ?? lodging.ratePlans[0]?.id ?? ""
              }
              className={inputClass}
            >
              <option value="">—</option>
              {lodging.ratePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <label className={labelClass}>
        Nome da variante
        <input
          name="variant_title"
          maxLength={200}
          defaultValue={variant?.title ?? "Padrão"}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        SKU
        <input
          name="sku"
          maxLength={64}
          defaultValue={variant?.sku ?? ""}
          className={inputClass}
        />
      </label>
      {lodging ? null : (
        <label className={labelClass}>
          Unidade de venda
          <select name="unit" defaultValue={unit} className={inputClass}>
            {SALE_UNITS.map((u) => (
              <option key={u.unit} value={u.unit}>
                {u.display_text}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={labelClass}>
        {lodging ? "Preço da diária (R$)" : "Preço (R$)"}
        <input
          name="price"
          inputMode="decimal"
          placeholder="49,90"
          defaultValue={moneyInput(variant?.priceAmount ?? null)}
          className={inputClass}
          data-testid={`${idPrefix}-price`}
        />
      </label>
      <label className={labelClass}>
        Preço cheio, antes do desconto (R$)
        <input
          name="list_price"
          inputMode="decimal"
          defaultValue={moneyInput(variant?.listPriceAmount ?? null)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Disponibilidade
        <select
          name="availability_status"
          defaultValue={variant?.availabilityStatus ?? "in_stock"}
          className={inputClass}
        >
          {AVAILABILITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {AVAILABILITY_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {lodging ? null : (
        <label className={`${labelClass} sm:col-span-2`}>
          Opções (ex.: Cor: Azul; Tamanho: M)
          <input
            name="options"
            defaultValue={variant?.options
              .map((o) => `${o.name}: ${o.label}`)
              .join("; ")}
            className={inputClass}
          />
        </label>
      )}
      <label className={labelClass}>
        Códigos de barras (um por linha, ex.: EAN | 789…)
        <textarea
          name="barcodes"
          rows={2}
          defaultValue={variant?.barcodes
            .map((b) => `${b.type} | ${b.value}`)
            .join("\n")}
          className={inputClass}
        />
      </label>
      <label className="text-12 text-text flex items-center gap-2">
        <input
          type="checkbox"
          name="track_inventory"
          defaultChecked={variant?.trackInventory}
        />
        Controlar estoque
      </label>
      <label className={labelClass}>
        Estoque
        <input
          name="stock_quantity"
          type="number"
          defaultValue={variant?.stockQuantity ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Alerta de estoque mínimo
        <input
          name="min_stock_alert"
          type="number"
          min={0}
          defaultValue={variant?.minStockAlert ?? ""}
          className={inputClass}
        />
      </label>
      <label className="text-12 text-text flex items-center gap-2">
        <input
          type="checkbox"
          name="allow_backorder"
          defaultChecked={variant?.allowBackorder}
        />
        Vender sem estoque (sob encomenda)
      </label>
    </div>
  );
}

/**
 * Fields of the vertical extension (F5b), generated from the declaration
 * in ../verticals.ts. Inputs are named `details.<key>`.
 */
export function DetailsFields({
  itemType,
  vertical,
  details,
}: Readonly<{
  itemType: string;
  vertical: string;
  details: Record<string, unknown>;
}>) {
  const fields = fieldsFor(itemType, vertical);
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="details-fields">
      {fields.map((spec) => {
        const name = `details.${spec.key}`;
        const value = getPath(details, spec.key);
        const label = `${spec.label}${spec.required ? " *" : ""}`;
        switch (spec.kind) {
          case "bool":
            return (
              <label
                key={name}
                className="text-12 text-text flex items-center gap-2"
              >
                <input type="hidden" name={`${name}.present`} value="1" />
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={value === true}
                />
                {label}
              </label>
            );
          case "enum":
            return (
              <label key={name} className={labelClass}>
                {label}
                <select
                  name={name}
                  defaultValue={typeof value === "string" ? value : ""}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {spec.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          case "multi":
            return (
              <fieldset key={name} className="space-y-1 sm:col-span-3">
                <legend className="text-12 text-text-subtle font-medium">
                  {label}
                </legend>
                <div className="flex flex-wrap gap-3">
                  {spec.options.map((o) => (
                    <label
                      key={o.value}
                      className="text-12 text-text flex gap-2"
                    >
                      <input
                        type="checkbox"
                        name={name}
                        value={o.value}
                        defaultChecked={
                          Array.isArray(value) && value.includes(o.value)
                        }
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          case "textarea":
          case "list":
            return (
              <label key={name} className={labelClass}>
                {label}
                <textarea
                  name={name}
                  rows={2}
                  defaultValue={formValue(spec, value)}
                  className={inputClass}
                />
              </label>
            );
          default:
            return (
              <label key={name} className={labelClass}>
                {label}
                <input
                  name={name}
                  type={
                    spec.kind === "int"
                      ? "number"
                      : spec.kind === "datetime"
                        ? "datetime-local"
                        : spec.kind === "time"
                          ? "time"
                          : "text"
                  }
                  inputMode={
                    spec.kind === "money" || spec.kind === "measure"
                      ? "decimal"
                      : undefined
                  }
                  maxLength={spec.kind === "text" ? spec.max : undefined}
                  defaultValue={formValue(spec, value)}
                  className={inputClass}
                />
              </label>
            );
        }
      })}
    </div>
  );
}
