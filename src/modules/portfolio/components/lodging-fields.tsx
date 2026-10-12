import { getTranslations } from "next-intl/server";

import { inputClass, labelClass } from "@/components/partners/action-form";

import { ACCOMMODATION_KINDS, BOARDS, REFUNDABILITY } from "../lodging";
import type {
  AccommodationTypeView,
  RatePlanView,
} from "../server/services/items";
import type { PortfolioTranslator } from "../verticals";

/** Form fields of the lodging screens (F5c). */

/** Label of a lodging value under a `portfolio` group, or the raw value. */
export function lodgingLabel(
  t: PortfolioTranslator,
  group: "accommodationKind" | "board" | "refundability",
  value: string,
): string {
  const key = `${group}.${value}`;
  return t.has(key) ? t(key) : value;
}

/** Room amenities; `label` is the Portuguese source of `roomAmenities.*`. */
export const ROOM_AMENITIES = [
  { id: "dev.ucp.amenity.wi_fi", label: "Wi-Fi" },
  { id: "co.guidu.amenity.air_conditioning", label: "Ar-condicionado" },
  { id: "co.guidu.amenity.tv", label: "TV" },
  { id: "co.guidu.amenity.minibar", label: "Frigobar" },
  { id: "co.guidu.amenity.kitchen", label: "Cozinha" },
  { id: "co.guidu.amenity.balcony", label: "Varanda" },
  { id: "co.guidu.amenity.hot_tub", label: "Banheira de hidromassagem" },
  { id: "co.guidu.amenity.accessibility", label: "Acessível" },
] as const;

function amenityLabel(
  t: PortfolioTranslator,
  amenity: (typeof ROOM_AMENITIES)[number],
): string {
  const key = `roomAmenities.${amenity.id.replaceAll(".", "_")}`;
  return t.has(key) ? t(key) : amenity.label;
}

const num = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/** UCP AccommodationType with capacity, plus the GUIDU extension. */
export async function AccommodationTypeFields({
  type,
}: Readonly<{ type?: AccommodationTypeView }>) {
  const t = await getTranslations("portfolio");
  const c = type?.capacity ?? {};
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className={`${labelClass} sm:col-span-2`}>
        {t("lodging.typeTitle")}
        <input
          name="type_title"
          required
          maxLength={200}
          defaultValue={type?.title ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.kind")}
        <select
          name="accommodation_kind"
          defaultValue={type?.accommodationKind ?? ""}
          className={inputClass}
        >
          <option value="">—</option>
          {ACCOMMODATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {lodgingLabel(t, "accommodationKind", k)}
            </option>
          ))}
        </select>
      </label>
      <label className={`${labelClass} sm:col-span-3`}>
        {t("lodging.typeDescription")}
        <textarea
          name="type_description"
          rows={2}
          maxLength={5000}
          defaultValue={type?.description ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.capacityTotal")}
        <input
          name="capacity_total"
          type="number"
          min={1}
          max={200}
          defaultValue={num(c.total)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.maxAdults")}
        <input
          name="capacity_adults"
          type="number"
          min={0}
          max={100}
          defaultValue={num(c.adults)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.maxChildren")}
        <input
          name="capacity_children"
          type="number"
          min={0}
          max={100}
          defaultValue={num(c.children)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.childAgeRanges")}
        <textarea
          name="child_age_ranges"
          rows={2}
          defaultValue={(c.child_age_ranges ?? [])
            .map(
              (r) =>
                `${r.ages.min}-${r.ages.max}${r.limit === undefined ? "" : ` | ${r.limit}`}`,
            )
            .join("\n")}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.bedrooms")}
        <input
          name="bedrooms"
          type="number"
          min={0}
          max={100}
          defaultValue={num(type?.bedrooms)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.beds")}
        <input
          name="beds_count"
          type="number"
          min={0}
          max={200}
          defaultValue={num(type?.bedsCount)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.bathrooms")}
        <input
          name="bathrooms"
          type="number"
          min={0}
          max={100}
          defaultValue={num(type?.bathrooms)}
          className={inputClass}
        />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        {t("lodging.photos")}
        <textarea
          name="type_media"
          rows={2}
          defaultValue={(type?.media ?? [])
            .map((m) => `${m.url}${m.alt_text ? ` | ${m.alt_text}` : ""}`)
            .join("\n")}
          className={inputClass}
        />
      </label>
      <fieldset className="space-y-1 sm:col-span-3">
        <legend className="text-12 text-text-subtle font-medium">
          {t("lodging.typeAmenities")}
        </legend>
        <div className="flex flex-wrap gap-3">
          {ROOM_AMENITIES.map((a) => (
            <label key={a.id} className="text-12 text-text flex gap-2">
              <input
                type="checkbox"
                name="type_amenities"
                value={a.id}
                defaultChecked={type?.amenities.includes(a.id)}
              />
              {amenityLabel(t, a)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** UCP RatePlan with its cancellation policy. */
export async function RatePlanFields({
  plan,
}: Readonly<{ plan?: RatePlanView }>) {
  const t = await getTranslations("portfolio");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className={labelClass}>
        {t("lodging.planTitle")}
        <input
          name="plan_title"
          required
          maxLength={200}
          defaultValue={plan?.title ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("lodging.board")}
        <select
          name="board"
          defaultValue={plan?.board ?? "room_only"}
          className={inputClass}
        >
          {BOARDS.map((b) => (
            <option key={b} value={b}>
              {lodgingLabel(t, "board", b)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        {t("lodging.refundability")}
        <select
          name="refundability"
          defaultValue={plan?.refundability ?? "refundable"}
          className={inputClass}
        >
          {REFUNDABILITY.map((r) => (
            <option key={r} value={r}>
              {lodgingLabel(t, "refundability", r)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        {t("lodging.freeCancellationHours")}
        <input
          name="free_cancellation_hours"
          type="number"
          min={0}
          max={8760}
          defaultValue={num(plan?.freeCancellationHours)}
          className={inputClass}
        />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        {t("lodging.cancellationPolicy")}
        <textarea
          name="cancellation_policy"
          rows={2}
          maxLength={2000}
          defaultValue={plan?.cancellationPolicy ?? ""}
          className={inputClass}
        />
      </label>
      <label className={`${labelClass} sm:col-span-3`}>
        {t("lodging.planDescription")}
        <textarea
          name="plan_description"
          rows={2}
          maxLength={5000}
          defaultValue={plan?.description ?? ""}
          className={inputClass}
        />
      </label>
    </div>
  );
}
