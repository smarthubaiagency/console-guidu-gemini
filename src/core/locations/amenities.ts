/**
 * Amenities offered on the location form, with the UCP identifiers
 * (`common/types/amenity_type.json`). Custom ones use `co.guidu.amenity.*`.
 */
export const KNOWN_AMENITIES = [
  { id: "dev.ucp.amenity.parking", label: "Estacionamento" },
  { id: "dev.ucp.amenity.wi_fi", label: "Wi-Fi" },
  { id: "dev.ucp.amenity.shopping.in_store_pickup", label: "Retirada na loja" },
  {
    id: "dev.ucp.amenity.shopping.curbside_pickup",
    label: "Retirada no carro",
  },
  { id: "co.guidu.amenity.accessibility", label: "Acessibilidade" },
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
