import { inputClass, labelClass } from "@/components/partners/action-form";

import { ACCOMMODATION_KINDS, BOARDS, REFUNDABILITY } from "../lodging";
import type {
  AccommodationTypeView,
  RatePlanView,
} from "../server/services/items";

/** Form fields of the lodging screens (F5c). */

export const ACCOMMODATION_KIND_LABELS: Record<
  (typeof ACCOMMODATION_KINDS)[number],
  string
> = {
  entire_home: "Casa ou apartamento inteiro",
  private_room: "Quarto privativo",
  shared_room: "Quarto compartilhado",
  hotel_room: "Quarto de hotel",
  suite: "Suíte",
  chalet: "Chalé",
  campsite: "Área de camping",
};

export const BOARD_LABELS: Record<(typeof BOARDS)[number], string> = {
  room_only: "Só hospedagem",
  breakfast: "Café da manhã",
  half_board: "Meia pensão",
  full_board: "Pensão completa",
  all_inclusive: "Tudo incluído",
};

export const REFUNDABILITY_LABELS: Record<
  (typeof REFUNDABILITY)[number],
  string
> = {
  refundable: "Reembolsável",
  partially_refundable: "Reembolso parcial",
  non_refundable: "Não reembolsável",
};

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

const num = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/** UCP AccommodationType with capacity, plus the GUIDU extension. */
export function AccommodationTypeFields({
  type,
}: Readonly<{ type?: AccommodationTypeView }>) {
  const c = type?.capacity ?? {};
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className={`${labelClass} sm:col-span-2`}>
        Nome da acomodação
        <input
          name="type_title"
          required
          maxLength={200}
          defaultValue={type?.title ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Tipo de espaço
        <select
          name="accommodation_kind"
          defaultValue={type?.accommodationKind ?? ""}
          className={inputClass}
        >
          <option value="">—</option>
          {ACCOMMODATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACCOMMODATION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className={`${labelClass} sm:col-span-3`}>
        Descrição da acomodação
        <textarea
          name="type_description"
          rows={2}
          maxLength={5000}
          defaultValue={type?.description ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Capacidade total (hóspedes) *
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
        Máximo de adultos
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
        Máximo de crianças
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
        Idades de criança (uma faixa por linha: 0-12 | limite)
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
        Quartos
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
        Camas
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
        Banheiros
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
        Fotos (uma URL por linha: url | texto alternativo)
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
          Comodidades da acomodação
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
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** UCP RatePlan with its cancellation policy. */
export function RatePlanFields({ plan }: Readonly<{ plan?: RatePlanView }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className={labelClass}>
        Nome da tarifa
        <input
          name="plan_title"
          required
          maxLength={200}
          defaultValue={plan?.title ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Alimentação
        <select
          name="board"
          defaultValue={plan?.board ?? "room_only"}
          className={inputClass}
        >
          {BOARDS.map((b) => (
            <option key={b} value={b}>
              {BOARD_LABELS[b]}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Cancelamento
        <select
          name="refundability"
          defaultValue={plan?.refundability ?? "refundable"}
          className={inputClass}
        >
          {REFUNDABILITY.map((r) => (
            <option key={r} value={r}>
              {REFUNDABILITY_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Cancelamento grátis até (horas antes do check-in)
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
        Política de cancelamento (texto para o hóspede)
        <textarea
          name="cancellation_policy"
          rows={2}
          maxLength={2000}
          defaultValue={plan?.cancellationPolicy ?? ""}
          className={inputClass}
        />
      </label>
      <label className={`${labelClass} sm:col-span-3`}>
        Descrição da tarifa
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
