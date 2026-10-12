import { getTranslations } from "next-intl/server";

import { ACCOMMODATION_KINDS, BOARDS, REFUNDABILITY } from "../lodging";
import type {
  AccommodationTypeView,
  RatePlanView,
} from "../server/services/items";
import type { PortfolioTranslator } from "../verticals";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

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
      <Label className="flex-col items-start sm:col-span-2">
        {t("lodging.typeTitle")}
        <Input
          name="type_title"
          required
          maxLength={200}
          defaultValue={type?.title ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.kind")}
        <NativeSelect
          name="accommodation_kind"
          defaultValue={type?.accommodationKind ?? ""}
          className="w-full"
        >
          <NativeSelectOption value="">—</NativeSelectOption>
          {ACCOMMODATION_KINDS.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {lodgingLabel(t, "accommodationKind", k)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start sm:col-span-3">
        {t("lodging.typeDescription")}
        <Textarea
          name="type_description"
          rows={2}
          maxLength={5000}
          defaultValue={type?.description ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.capacityTotal")}
        <Input
          name="capacity_total"
          type="number"
          min={1}
          max={200}
          defaultValue={num(c.total)}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.maxAdults")}
        <Input
          name="capacity_adults"
          type="number"
          min={0}
          max={100}
          defaultValue={num(c.adults)}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.maxChildren")}
        <Input
          name="capacity_children"
          type="number"
          min={0}
          max={100}
          defaultValue={num(c.children)}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.childAgeRanges")}
        <Textarea
          name="child_age_ranges"
          rows={2}
          defaultValue={(c.child_age_ranges ?? [])
            .map(
              (r) =>
                `${r.ages.min}-${r.ages.max}${r.limit === undefined ? "" : ` | ${r.limit}`}`,
            )
            .join("\n")}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.bedrooms")}
        <Input
          name="bedrooms"
          type="number"
          min={0}
          max={100}
          defaultValue={num(type?.bedrooms)}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.beds")}
        <Input
          name="beds_count"
          type="number"
          min={0}
          max={200}
          defaultValue={num(type?.bedsCount)}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.bathrooms")}
        <Input
          name="bathrooms"
          type="number"
          min={0}
          max={100}
          defaultValue={num(type?.bathrooms)}
        />
      </Label>
      <Label className="flex-col items-start sm:col-span-2">
        {t("lodging.photos")}
        <Textarea
          name="type_media"
          rows={2}
          defaultValue={(type?.media ?? [])
            .map((m) => `${m.url}${m.alt_text ? ` | ${m.alt_text}` : ""}`)
            .join("\n")}
        />
      </Label>
      <fieldset className="space-y-1 sm:col-span-3">
        <legend className="text-12 text-text-subtle font-medium">
          {t("lodging.typeAmenities")}
        </legend>
        <div className="flex flex-wrap gap-3">
          {ROOM_AMENITIES.map((a) => (
            <Label key={a.id} className="text-12 text-text flex gap-2">
              <Checkbox
                name="type_amenities"
                value={a.id}
                defaultChecked={Boolean(type?.amenities.includes(a.id))}
              />
              {amenityLabel(t, a)}
            </Label>
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
      <Label className="flex-col items-start">
        {t("lodging.planTitle")}
        <Input
          name="plan_title"
          required
          maxLength={200}
          defaultValue={plan?.title ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.board")}
        <NativeSelect
          name="board"
          defaultValue={plan?.board ?? "room_only"}
          className="w-full"
        >
          {BOARDS.map((b) => (
            <NativeSelectOption key={b} value={b}>
              {lodgingLabel(t, "board", b)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.refundability")}
        <NativeSelect
          name="refundability"
          defaultValue={plan?.refundability ?? "refundable"}
          className="w-full"
        >
          {REFUNDABILITY.map((r) => (
            <NativeSelectOption key={r} value={r}>
              {lodgingLabel(t, "refundability", r)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <Label className="flex-col items-start">
        {t("lodging.freeCancellationHours")}
        <Input
          name="free_cancellation_hours"
          type="number"
          min={0}
          max={8760}
          defaultValue={num(plan?.freeCancellationHours)}
        />
      </Label>
      <Label className="flex-col items-start sm:col-span-2">
        {t("lodging.cancellationPolicy")}
        <Textarea
          name="cancellation_policy"
          rows={2}
          maxLength={2000}
          defaultValue={plan?.cancellationPolicy ?? ""}
        />
      </Label>
      <Label className="flex-col items-start sm:col-span-3">
        {t("lodging.planDescription")}
        <Textarea
          name="plan_description"
          rows={2}
          maxLength={5000}
          defaultValue={plan?.description ?? ""}
        />
      </Label>
    </div>
  );
}
