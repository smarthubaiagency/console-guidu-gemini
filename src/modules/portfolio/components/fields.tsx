import { getFormatter, getTranslations } from "next-intl/server";

import { inputClass, labelClass } from "@/components/partners/form-classes";

import { AVAILABILITY_STATUSES, SALE_UNITS } from "../ucp";
import type { LodgingView, VariantView } from "../server/services/items";
import {
  fieldsFor,
  formValue,
  getPath,
  type PortfolioTranslator,
  translatedFieldLabel,
  translatedOptionLabel,
} from "../verticals";

/** Shared labels and form fields of the Portfolio screens (F5a). */

/** Item statuses, in the order of the selects. */
export const ITEM_STATUSES = [
  "draft",
  "active",
  "inactive",
  "archived",
] as const;

/** Price display modes, in the order of the selects. */
export const PRICE_DISPLAYS = ["price", "from", "quote"] as const;

/** Label of a stored value under a `portfolio` group, or the raw value. */
export function labelOf(
  t: PortfolioTranslator,
  group: "status" | "availability" | "priceDisplay" | "fulfillment",
  value: string,
): string {
  const key = `${group}.${value}`;
  return t.has(key) ? t(key) : value;
}

/** "4990" -> "49,90" for the inputs. */
export function moneyInput(amount: number | null): string {
  return amount === null ? "" : (amount / 100).toFixed(2).replace(".", ",");
}

/** Price in the request language, in the item's currency (BRL). */
export async function formatMoney(
  amount: number | null,
  currency = "BRL",
): Promise<string> {
  if (amount === null) {
    const t = await getTranslations("portfolio");
    return t("money.quote");
  }
  const format = await getFormatter();
  return format.number(amount / 100, { style: "currency", currency });
}

/**
 * Fields of a variant (UCP Variant plus internal stock). In lodging (F5c)
 * a variant is the nightly price of one accommodation type under one rate
 * plan, chosen instead of the sale unit and the free options.
 */
export async function VariantFields({
  variant,
  idPrefix,
  lodging,
}: Readonly<{
  variant?: VariantView;
  idPrefix: string;
  lodging?: LodgingView | null;
}>) {
  const t = await getTranslations("portfolio");
  const unit = variant?.quantityUnit?.unit ?? "C62";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {lodging ? (
        <>
          <input type="hidden" name="lodging" value="1" />
          <label className={labelClass}>
            {t("variant.accommodation")}
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
              {lodging.accommodationTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.title}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("variant.ratePlan")}
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
        {t("variant.title")}
        <input
          name="variant_title"
          maxLength={200}
          defaultValue={variant?.title ?? t("variant.defaultTitle")}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("variant.sku")}
        <input
          name="sku"
          maxLength={64}
          defaultValue={variant?.sku ?? ""}
          className={inputClass}
        />
      </label>
      {lodging ? null : (
        <label className={labelClass}>
          {t("variant.unit")}
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
        {lodging ? t("variant.nightlyPrice") : t("variant.price")}
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
        {t("variant.listPrice")}
        <input
          name="list_price"
          inputMode="decimal"
          defaultValue={moneyInput(variant?.listPriceAmount ?? null)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("variant.availability")}
        <select
          name="availability_status"
          defaultValue={variant?.availabilityStatus ?? "in_stock"}
          className={inputClass}
        >
          {AVAILABILITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {labelOf(t, "availability", s)}
            </option>
          ))}
        </select>
      </label>
      {lodging ? null : (
        <label className={`${labelClass} sm:col-span-2`}>
          {t("variant.options")}
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
        {t("variant.barcodes")}
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
        {t("variant.trackInventory")}
      </label>
      <label className={labelClass}>
        {t("variant.stock")}
        <input
          name="stock_quantity"
          type="number"
          defaultValue={variant?.stockQuantity ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("variant.minStockAlert")}
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
        {t("variant.allowBackorder")}
      </label>
    </div>
  );
}

/**
 * Fields of the vertical extension (F5b), generated from the declaration
 * in ../verticals.ts. Inputs are named `details.<key>`.
 */
export async function DetailsFields({
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
  const t = await getTranslations("portfolio");
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="details-fields">
      {fields.map((spec) => {
        const name = `details.${spec.key}`;
        const value = getPath(details, spec.key);
        const label = `${translatedFieldLabel(t, itemType, vertical, spec)}${spec.required ? " *" : ""}`;
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
                      {translatedOptionLabel(t, itemType, spec, o)}
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
                      {translatedOptionLabel(t, itemType, spec, o)}
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
