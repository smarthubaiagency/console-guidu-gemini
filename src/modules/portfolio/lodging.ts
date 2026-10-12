import { z } from "zod";

import {
  extensionKey,
  EXTENSION_NAMESPACE,
  type SerializableItem,
  type SerializableVariant,
  toUcpProduct,
  UcpMedia,
} from "./ucp";

/**
 * Lodging of the Portfolio (F5c), in the UCP lodging model
 * (`lodging/types/*.json`, commit ad9950b):
 *
 * - the lodging item is the listing of one **Property**, which is the
 *   item's workspace location (UCP Property = Location + media);
 * - **AccommodationType**: the rentable space, with its `capacity`;
 * - **RatePlan**: the commercial terms, with the cancellation policy
 *   (`dev.ucp.lodging.policy.cancellation`);
 * - each variant prices one accommodation type under one rate plan, per
 *   night (the UCP Stay binds the same pair at booking time).
 *
 * Register only: the booking capability (`create_booking_session`...)
 * depends on calendar and payment and comes later. What UCP does not model
 * (kind of space, rooms, board, free cancellation window, house rules and
 * fees) travels as `co.guidu.*` extensions.
 */

export const CANCELLATION_POLICY_TYPE = "dev.ucp.lodging.policy.cancellation";

export const REFUNDABILITY = [
  "refundable",
  "partially_refundable",
  "non_refundable",
] as const;

export const BOARDS = [
  "room_only",
  "breakfast",
  "half_board",
  "full_board",
  "all_inclusive",
] as const;

export const ACCOMMODATION_KINDS = [
  "entire_home",
  "private_room",
  "shared_room",
  "hotel_room",
  "suite",
  "chalet",
  "campsite",
] as const;

/**
 * Custom validation messages of the lodging schemas. The services give
 * them a translation key when they reach the screen (I4).
 */
export const LODGING_VALIDATION = {
  ageRangeInverted: "Faixa de idade invertida.",
  capacityTotal:
    "A capacidade total não pode ser menor que a de adultos ou de crianças.",
  reverseId: "Use um identificador reverso.",
  typeTitleRequired: "Informe o nome da acomodação.",
  planTitleRequired: "Informe o nome da tarifa.",
  nothingToChange: "Nada para alterar.",
} as const;

/** Sale basis of a lodging variant: one night. */
export const NIGHT_UNIT = { unit: "DAY", display_text: "diária" } as const;

const ACCOMMODATION_EXTENSION = `${EXTENSION_NAMESPACE}.portfolio.accommodation_type`;
const RATE_PLAN_EXTENSION = `${EXTENSION_NAMESPACE}.portfolio.rate_plan`;
const LODGING_EXTENSION = extensionKey("lodging", "general");

/** UCP Capacity (`lodging/types/capacity.json`). */
export const UcpCapacity = z
  .object({
    adults: z.number().int().min(0).max(100).optional(),
    children: z.number().int().min(0).max(100).optional(),
    child_age_ranges: z
      .array(
        z
          .object({
            ages: z
              .object({
                min: z.number().int().min(0).max(17),
                max: z.number().int().min(0).max(17),
              })
              .strict()
              .refine(
                (a) => a.min <= a.max,
                LODGING_VALIDATION.ageRangeInverted,
              ),
            limit: z.number().int().min(0).max(100).optional(),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    total: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (c) =>
      c.total === undefined ||
      c.total >= Math.max(c.adults ?? 0, c.children ?? 0),
    LODGING_VALIDATION.capacityTotal,
  );

const amenityId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9_-]+)+$/, LODGING_VALIDATION.reverseId);

/** Accommodation type fields without defaults (updates send only changes). */
export const accommodationTypeShape = {
  title: z
    .string()
    .trim()
    .min(1, LODGING_VALIDATION.typeTitleRequired)
    .max(200),
  description: z.string().trim().min(1).max(5000).nullable().optional(),
  capacity: UcpCapacity,
  media: z.array(UcpMedia).max(20),
  accommodation_kind: z.enum(ACCOMMODATION_KINDS).nullable().optional(),
  bedrooms: z.number().int().min(0).max(100).nullable().optional(),
  beds_count: z.number().int().min(0).max(200).nullable().optional(),
  bathrooms: z.number().int().min(0).max(100).nullable().optional(),
  amenities: z.array(amenityId).max(50),
};

export const AccommodationTypeInput = z
  .object({
    ...accommodationTypeShape,
    capacity: accommodationTypeShape.capacity.default({}),
    media: accommodationTypeShape.media.default([]),
    amenities: accommodationTypeShape.amenities.default([]),
  })
  .strict();

export const AccommodationTypeUpdateInput = z
  .object(accommodationTypeShape)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, LODGING_VALIDATION.nothingToChange);

/** Rate plan fields without defaults. */
export const ratePlanShape = {
  title: z
    .string()
    .trim()
    .min(1, LODGING_VALIDATION.planTitleRequired)
    .max(200),
  description: z.string().trim().min(1).max(5000).nullable().optional(),
  refundability: z.enum(REFUNDABILITY),
  cancellation_policy: z.string().trim().min(1).max(2000).nullable().optional(),
  free_cancellation_hours: z
    .number()
    .int()
    .min(0)
    .max(8760)
    .nullable()
    .optional(),
  board: z.enum(BOARDS),
};

export const RatePlanInput = z
  .object({
    ...ratePlanShape,
    refundability: ratePlanShape.refundability.default("refundable"),
    board: ratePlanShape.board.default("room_only"),
  })
  .strict();

export const RatePlanUpdateInput = z
  .object(ratePlanShape)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, LODGING_VALIDATION.nothingToChange);

// ---------------------------------------------------------------------------
// Serializer: lodging item -> UCP Product with Property, AccommodationType
// and RatePlan in its metadata
// ---------------------------------------------------------------------------

export type SerializableAccommodationType = Readonly<{
  id: string;
  title: string;
  description: string | null;
  capacity: z.infer<typeof UcpCapacity>;
  media: z.infer<typeof UcpMedia>[];
  accommodationKind: string | null;
  bedrooms: number | null;
  bedsCount: number | null;
  bathrooms: number | null;
  amenities: string[];
}>;

export type SerializableRatePlan = Readonly<{
  id: string;
  title: string;
  description: string | null;
  refundability: (typeof REFUNDABILITY)[number];
  cancellationPolicy: string | null;
  freeCancellationHours: number | null;
  board: (typeof BOARDS)[number];
}>;

/** The property: a workspace location in the UCP Location shape. */
export type SerializableProperty = Readonly<{
  id: string;
  name: string;
  address: Record<string, string | undefined>;
  geo: { latitude: number; longitude: number } | null;
  timezone: string;
  hours: readonly unknown[];
  amenities: Record<string, { description: string }>;
}>;

export type SerializableLodging = Readonly<{
  property: SerializableProperty | null;
  accommodationTypes: readonly SerializableAccommodationType[];
  ratePlans: readonly SerializableRatePlan[];
}>;

export type SerializableLodgingVariant = SerializableVariant &
  Readonly<{
    accommodationTypeId: string | null;
    ratePlanId: string | null;
  }>;

function compact(
  value: Record<string, unknown | null | undefined>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, v]) =>
        v !== null &&
        v !== undefined &&
        !(Array.isArray(v) && v.length === 0) &&
        !(
          typeof v === "object" &&
          !Array.isArray(v) &&
          Object.keys(v as object).length === 0
        ),
    ),
  );
}

/** UCP Property (`lodging/types/property.json`): Location plus media. */
export function ucpProperty(
  property: SerializableProperty,
  media: readonly z.infer<typeof UcpMedia>[],
): Record<string, unknown> {
  return compact({
    id: property.id,
    name: property.name,
    address: compact(property.address),
    geo: property.geo,
    timezone: property.timezone,
    hours: property.hours,
    amenities: property.amenities,
    media,
  });
}

/** UCP AccommodationType, with the GUIDU extension. */
export function ucpAccommodationType(
  type: SerializableAccommodationType,
): Record<string, unknown> {
  return compact({
    id: type.id,
    title: type.title,
    description: type.description,
    capacity: type.capacity,
    media: type.media,
    [ACCOMMODATION_EXTENSION]: compact({
      accommodation_kind: type.accommodationKind,
      bedrooms: type.bedrooms,
      beds_count: type.bedsCount,
      bathrooms: type.bathrooms,
      amenities: type.amenities,
    }),
  });
}

/** Plain summary of a cancellation policy, when none was written. */
export function cancellationSummary(plan: SerializableRatePlan): string {
  if (plan.cancellationPolicy) return plan.cancellationPolicy;
  switch (plan.refundability) {
    case "non_refundable":
      return "Tarifa não reembolsável: o cancelamento não tem reembolso.";
    case "partially_refundable":
      return "Cancelamento com reembolso parcial.";
    case "refundable":
      return plan.freeCancellationHours !== null
        ? `Cancelamento grátis até ${plan.freeCancellationHours} horas antes do check-in.`
        : "Cancelamento grátis.";
  }
}

/** UCP RatePlan, with its cancellation policy and the GUIDU extension. */
export function ucpRatePlan(
  plan: SerializableRatePlan,
): Record<string, unknown> {
  return compact({
    id: plan.id,
    title: plan.title,
    description: plan.description,
    policies: [
      {
        type: CANCELLATION_POLICY_TYPE,
        refundability: plan.refundability,
        description: { plain: cancellationSummary(plan) },
      },
    ],
    [RATE_PLAN_EXTENSION]: compact({
      board: plan.board,
      free_cancellation_hours: plan.freeCancellationHours,
    }),
  });
}

/**
 * UCP Product of a lodging item. Each variant shows its accommodation type
 * and rate plan as options and links them in its metadata; the product
 * metadata carries the property, the types, the plans and the house rules.
 */
export function toUcpLodgingProduct(
  item: SerializableItem,
  variants: readonly SerializableLodgingVariant[],
  lodging: SerializableLodging,
): Record<string, unknown> | null {
  const types = new Map(lodging.accommodationTypes.map((t) => [t.id, t]));
  const plans = new Map(lodging.ratePlans.map((p) => [p.id, p]));
  const withOptions = variants.map((v) => {
    const type = v.accommodationTypeId
      ? types.get(v.accommodationTypeId)
      : undefined;
    const plan = v.ratePlanId ? plans.get(v.ratePlanId) : undefined;
    return type && plan
      ? {
          ...v,
          options: [
            { name: "Acomodação", label: type.title },
            { name: "Tarifa", label: plan.title },
          ],
        }
      : v;
  });
  const { details, ...core } = item;
  const product = toUcpProduct(core, withOptions);
  if (!product) return null;

  const byId = new Map(variants.map((v) => [v.id, v]));
  product.variants = (product.variants as Record<string, unknown>[]).map(
    (variant) => {
      const source = byId.get(variant.id as string);
      const link = compact({
        accommodation_type_id: source?.accommodationTypeId,
        rate_plan_id: source?.ratePlanId,
      });
      return Object.keys(link).length
        ? { ...variant, metadata: { [LODGING_EXTENSION]: link } }
        : variant;
    },
  );
  product.metadata = {
    [LODGING_EXTENSION]: compact({
      ...(details ?? {}),
      property: lodging.property
        ? ucpProperty(lodging.property, item.media)
        : null,
      accommodation_types: lodging.accommodationTypes.map(ucpAccommodationType),
      rate_plans: lodging.ratePlans.map(ucpRatePlan),
    }),
  };
  return product;
}
