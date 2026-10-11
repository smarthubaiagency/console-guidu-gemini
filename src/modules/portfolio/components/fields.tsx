import { inputClass, labelClass } from "@/components/partners/action-form";

import { AVAILABILITY_STATUSES, SALE_UNITS } from "../ucp";
import type { VariantView } from "../server/services/items";

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

/** Fields of a variant (UCP Variant plus internal stock). */
export function VariantFields({
  variant,
  idPrefix,
}: Readonly<{ variant?: VariantView; idPrefix: string }>) {
  const unit = variant?.quantityUnit?.unit ?? "C62";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
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
      <label className={labelClass}>
        Preço (R$)
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
