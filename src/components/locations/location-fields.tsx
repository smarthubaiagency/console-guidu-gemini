import { useTranslations } from "next-intl";

import { KNOWN_AMENITIES } from "@/core/locations/amenities";
import { DAYS, type LocationView } from "@/core/locations/service";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Fields of a store (UCP Location) for the create and edit forms (F5a).
 * Hours: one interval per day; an empty day is closed.
 */
export function LocationFields({
  location,
  defaultTimezone,
}: Readonly<{ location?: LocationView; defaultTimezone?: string }>) {
  const t = useTranslations("locations");
  const a = location?.address ?? {};
  const hour = (day: string) => location?.hours.find((h) => h.day === day);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Label className="flex-col items-start sm:col-span-2">
        {t("fields.name")}
        <Input
          name="name"
          required
          maxLength={120}
          defaultValue={location?.name}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.streetAddress")}
        <Input
          name="street_address"
          maxLength={200}
          defaultValue={a.street_address}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.extendedAddress")}
        <Input
          name="extended_address"
          maxLength={200}
          defaultValue={a.extended_address}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.locality")}
        <Input
          name="address_locality"
          maxLength={120}
          defaultValue={a.address_locality}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.region")}
        <Input
          name="address_region"
          maxLength={80}
          defaultValue={a.address_region}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.postalCode")}
        <Input name="postal_code" maxLength={20} defaultValue={a.postal_code} />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.country")}
        <Input
          name="address_country"
          maxLength={2}
          defaultValue={a.address_country ?? "BR"}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.phone")}
        <Input
          name="phone_number"
          maxLength={16}
          defaultValue={a.phone_number}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.timezone")}
        <Input
          name="timezone"
          maxLength={64}
          defaultValue={location?.timezone ?? defaultTimezone}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.latitude")}
        <Input
          name="latitude"
          inputMode="decimal"
          defaultValue={location?.geo?.latitude}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.longitude")}
        <Input
          name="longitude"
          inputMode="decimal"
          defaultValue={location?.geo?.longitude}
        />
      </Label>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-12 text-text-subtle font-medium">
          {t("fields.hours")}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center gap-2">
              <span className="text-12 text-text w-20">{t(`days.${day}`)}</span>
              <Input
                name={`${day}_opens`}
                type="time"
                aria-label={t("fields.opens", { day: t(`days.${day}`) })}
                defaultValue={hour(day)?.opens}
              />
              <Input
                name={`${day}_closes`}
                type="time"
                aria-label={t("fields.closes", { day: t(`days.${day}`) })}
                defaultValue={hour(day)?.closes}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-12 text-text-subtle font-medium">
          {t("fields.amenities")}
        </legend>
        <div className="flex flex-wrap gap-4">
          {KNOWN_AMENITIES.map((amenity) => (
            <Label key={amenity.id} className="text-12 font-normal">
              <Checkbox
                name={`amenity_${amenity.id}`}
                defaultChecked={Boolean(location?.amenities[amenity.id])}
              />
              {t(`amenities.${amenity.key}`)}
            </Label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
