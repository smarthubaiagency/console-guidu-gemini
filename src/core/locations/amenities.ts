/**
 * Amenities offered on the location form, with the UCP identifiers
 * (`common/types/amenity_type.json`). Custom ones use `co.guidu.amenity.*`.
 * `key` names the translated label under `locations.amenities` (I2); `label`
 * and `DAY_LABELS` keep the Portuguese text.
 */
export const KNOWN_AMENITIES = [
  { id: "dev.ucp.amenity.parking", key: "parking", label: "Estacionamento" },
  { id: "dev.ucp.amenity.wi_fi", key: "wiFi", label: "Wi-Fi" },
  {
    id: "dev.ucp.amenity.shopping.in_store_pickup",
    key: "inStorePickup",
    label: "Retirada na loja",
  },
  {
    id: "dev.ucp.amenity.shopping.curbside_pickup",
    key: "curbsidePickup",
    label: "Retirada no carro",
  },
  {
    id: "co.guidu.amenity.accessibility",
    key: "accessibility",
    label: "Acessibilidade",
  },
] as const;

export const DAY_LABELS: Record<string, string> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};
