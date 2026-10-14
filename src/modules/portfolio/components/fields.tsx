import { getFormatter, getTranslations } from "next-intl/server";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

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

/** Price in the request language, in the variant's currency. */
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
          <Label className="flex-col items-start">
            {t("variant.accommodation")}
            <NativeSelect
              name="accommodation_type_id"
              defaultValue={
                variant?.accommodationTypeId ??
                lodging.accommodationTypes[0]?.id ??
                ""
              }
              className="w-full"
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {lodging.accommodationTypes.map((type) => (
                <NativeSelectOption key={type.id} value={type.id}>
                  {type.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("variant.ratePlan")}
            <NativeSelect
              name="rate_plan_id"
              defaultValue={
                variant?.ratePlanId ?? lodging.ratePlans[0]?.id ?? ""
              }
              className="w-full"
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {lodging.ratePlans.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
        </>
      ) : null}
      <Label className="flex-col items-start">
        {t("variant.title")}
        <Input
          name="variant_title"
          maxLength={200}
          defaultValue={variant?.title ?? t("variant.defaultTitle")}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("variant.sku")}
        <Input name="sku" maxLength={64} defaultValue={variant?.sku ?? ""} />
      </Label>
      {lodging ? null : (
        <Label className="flex-col items-start">
          {t("variant.unit")}
          <NativeSelect name="unit" defaultValue={unit} className="w-full">
            {SALE_UNITS.map((u) => (
              <NativeSelectOption key={u.unit} value={u.unit}>
                {u.display_text}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
      )}
      <Label className="flex-col items-start">
        {lodging ? t("variant.nightlyPrice") : t("variant.price")}
        <Input
          name="price"
          inputMode="decimal"
          placeholder="49,90"
          defaultValue={moneyInput(variant?.priceAmount ?? null)}

          data-testid={`${idPrefix}-price`}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("variant.listPrice")}
        <Input
          name="list_price"
          inputMode="decimal"
          defaultValue={moneyInput(variant?.listPriceAmount ?? null)}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("variant.availability")}
        <NativeSelect
          name="availability_status"
          defaultValue={variant?.availabilityStatus ?? "in_stock"}
          className="w-full"
        >
          {AVAILABILITY_STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {labelOf(t, "availability", s)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      {lodging ? null : (
        <Label className="flex-col items-start sm:col-span-2">
          {t("variant.options")}
          <Input
            name="options"
            defaultValue={variant?.options
              .map((o) => `${o.name}: ${o.label}`)
              .join("; ")}
          />
        </Label>
      )}
      <Label className="flex-col items-start">
        {t("variant.barcodes")}
        <Textarea
          name="barcodes"
          rows={2}
          defaultValue={variant?.barcodes
            .map((b) => `${b.type} | ${b.value}`)
            .join("\n")}
        />
      </Label>
      <Label className="text-12 text-text flex items-center gap-2">
        <Checkbox
          name="track_inventory"
          defaultChecked={Boolean(variant?.trackInventory)}
        />
        {t("variant.trackInventory")}
      </Label>
      <Label className="flex-col items-start">
        {t("variant.stock")}
        <Input
          name="stock_quantity"
          type="number"
          defaultValue={variant?.stockQuantity ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("variant.minStockAlert")}
        <Input
          name="min_stock_alert"
          type="number"
          min={0}
          defaultValue={variant?.minStockAlert ?? ""}
        />
      </Label>
      <Label className="text-12 text-text flex items-center gap-2">
        <Checkbox
          name="allow_backorder"
          defaultChecked={Boolean(variant?.allowBackorder)}
        />
        {t("variant.allowBackorder")}
      </Label>
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
              <Label
                key={name}
                className="text-12 text-text flex items-center gap-2"
              >
                <input type="hidden" name={`${name}.present`} value="1" />
                <Checkbox name={name} defaultChecked={value === true} />
                {label}
              </Label>
            );
          case "enum":
            return (
              <Label key={name} className="flex-col items-start">
                {label}
                <NativeSelect
                  name={name}
                  defaultValue={typeof value === "string" ? value : ""}
                  className="w-full"
                >
                  <NativeSelectOption value="">—</NativeSelectOption>
                  {spec.options.map((o) => (
                    <NativeSelectOption key={o.value} value={o.value}>
                      {translatedOptionLabel(t, itemType, spec, o)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
            );
          case "multi":
            return (
              <fieldset key={name} className="space-y-1 sm:col-span-3">
                <legend className="text-12 text-text-subtle font-medium">
                  {label}
                </legend>
                <div className="flex flex-wrap gap-3">
                  {spec.options.map((o) => (
                    <Label
                      key={o.value}
                      className="text-12 text-text flex gap-2"
                    >
                      <Checkbox
                        name={name}
                        value={o.value}
                        defaultChecked={
                          Array.isArray(value) && value.includes(o.value)
                        }
                      />
                      {translatedOptionLabel(t, itemType, spec, o)}
                    </Label>
                  ))}
                </div>
              </fieldset>
            );
          case "textarea":
          case "list":
            return (
              <Label key={name} className="flex-col items-start">
                {label}
                <Textarea
                  name={name}
                  rows={2}
                  defaultValue={formValue(spec, value)}
                />
              </Label>
            );
          default:
            return (
              <Label key={name} className="flex-col items-start">
                {label}
                <Input
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
                />
              </Label>
            );
        }
      })}
    </div>
  );
}
