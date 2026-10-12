import { useTranslations } from "next-intl";

import { inputClass, labelClass } from "@/components/partners/form-classes";
import { KNOWN_AMENITIES } from "@/core/locations/amenities";
import { DAYS, type LocationView } from "@/core/locations/service";

/**
 * Fields of a store (UCP Location) for the create and edit forms (F5a).
 * Hours: one interval per day; an empty day is closed.
 */
export function LocationFields({
  location,
}: Readonly<{ location?: LocationView }>) {
  const t = useTranslations("locations");
  const a = location?.address ?? {};
  const hour = (day: string) => location?.hours.find((h) => h.day === day);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={`${labelClass} sm:col-span-2`}>
        {t("fields.name")}
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={location?.name}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.streetAddress")}
        <input
          name="street_address"
          maxLength={200}
          defaultValue={a.street_address}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.extendedAddress")}
        <input
          name="extended_address"
          maxLength={200}
          defaultValue={a.extended_address}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.locality")}
        <input
          name="address_locality"
          maxLength={120}
          defaultValue={a.address_locality}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.region")}
        <input
          name="address_region"
          maxLength={80}
          defaultValue={a.address_region}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.postalCode")}
        <input
          name="postal_code"
          maxLength={20}
          defaultValue={a.postal_code}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.country")}
        <input
          name="address_country"
          maxLength={2}
          defaultValue={a.address_country ?? "BR"}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.phone")}
        <input
          name="phone_number"
          maxLength={16}
          defaultValue={a.phone_number}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.timezone")}
        <input
          name="timezone"
          maxLength={64}
          defaultValue={location?.timezone ?? "America/Sao_Paulo"}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.latitude")}
        <input
          name="latitude"
          inputMode="decimal"
          defaultValue={location?.geo?.latitude}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t("fields.longitude")}
        <input
          name="longitude"
          inputMode="decimal"
          defaultValue={location?.geo?.longitude}
          className={inputClass}
        />
      </label>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-12 text-text-subtle font-medium">
          {t("fields.hours")}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center gap-2">
              <span className="text-12 text-text w-20">{t(`days.${day}`)}</span>
              <input
                name={`${day}_opens`}
                type="time"
                aria-label={t("fields.opens", { day: t(`days.${day}`) })}
                defaultValue={hour(day)?.opens}
                className={inputClass}
              />
              <input
                name={`${day}_closes`}
                type="time"
                aria-label={t("fields.closes", { day: t(`days.${day}`) })}
                defaultValue={hour(day)?.closes}
                className={inputClass}
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
            <label key={amenity.id} className="text-12 text-text flex gap-2">
              <input
                type="checkbox"
                name={`amenity_${amenity.id}`}
                defaultChecked={Boolean(location?.amenities[amenity.id])}
              />
              {t(`amenities.${amenity.key}`)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
