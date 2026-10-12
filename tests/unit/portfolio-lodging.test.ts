import { describe, expect, it } from "vitest";

import {
  AccommodationTypeInput,
  RatePlanInput,
  toUcpLodgingProduct,
  type SerializableLodging,
  type SerializableLodgingVariant,
} from "@/modules/portfolio/lodging";
import type { SerializableItem } from "@/modules/portfolio/ucp";
import { detailsFromForm, detailsSchema } from "@/modules/portfolio/verticals";

import { ucpErrors } from "./support/ucp";

const item: SerializableItem = {
  id: "f5c00000-0000-4000-8000-000000000001",
  title: "Pousada Mar",
  handle: "pousada-mar",
  description: { plain: "Pé na areia." },
  categories: [],
  media: [{ type: "image", url: "https://example.com/fachada.jpg" }],
  tags: [],
  url: null,
  rating: null,
  priceDisplay: "price",
  itemType: "lodging",
  vertical: "general",
  details: { check_in_time: "14:00", check_out_time: "11:00" },
  status: "active",
  visibility: "public",
  aiDiscoveryEnabled: true,
};

const lodging: SerializableLodging = {
  property: {
    id: "f5c00000-0000-4000-8000-0000000000f1",
    name: "Pousada Mar",
    address: { address_locality: "Ubatuba", address_country: "BR" },
    geo: { latitude: -23.43, longitude: -45.07 },
    timezone: "America/Sao_Paulo",
    hours: [],
    amenities: {},
  },
  accommodationTypes: [
    {
      id: "f5c00000-0000-4000-8000-0000000000a1",
      title: "Suíte casal",
      description: null,
      capacity: { adults: 2, total: 2 },
      media: [],
      accommodationKind: "suite",
      bedrooms: 1,
      bedsCount: 1,
      bathrooms: 1,
      amenities: [],
    },
  ],
  ratePlans: [
    {
      id: "f5c00000-0000-4000-8000-0000000000b1",
      title: "Não reembolsável",
      description: null,
      refundability: "non_refundable",
      cancellationPolicy: null,
      freeCancellationHours: null,
      board: "breakfast",
    },
  ],
};

const variant: SerializableLodgingVariant = {
  id: "f5c00000-0000-4000-8000-0000000000c1",
  title: "Diária",
  sku: null,
  barcodes: [],
  priceAmount: 45000,
  listPriceAmount: null,
  currency: "BRL",
  quantityUnit: { unit: "DAY", display_text: "diária" },
  options: [{ name: "Cor", label: "ignorada" }],
  media: [],
  availabilityStatus: "in_stock",
  trackInventory: false,
  stockQuantity: null,
  allowBackorder: false,
  accommodationTypeId: "f5c00000-0000-4000-8000-0000000000a1",
  ratePlanId: "f5c00000-0000-4000-8000-0000000000b1",
};

describe("Portfolio lodging (F5c)", () => {
  it("serializes a lodging item into the UCP lodging shapes", () => {
    const product = toUcpLodgingProduct(item, [variant], lodging)!;
    expect(ucpErrors("shopping/types/product.json", product)).toEqual([]);
    const ext = (product.metadata as Record<string, Record<string, unknown>>)[
      "co.guidu.portfolio.lodging"
    ]!;
    expect(ucpErrors("lodging/types/property.json", ext.property)).toEqual([]);
    expect(ucpErrors("common/types/location.json", ext.property)).toEqual([]);
    expect(ext.property).toMatchObject({
      media: [{ url: "https://example.com/fachada.jpg" }],
    });
    const [type] = ext.accommodation_types as unknown[];
    const [plan] = ext.rate_plans as Record<string, unknown>[];
    expect(ucpErrors("lodging/types/accommodation_type.json", type)).toEqual(
      [],
    );
    expect(ucpErrors("lodging/types/rate_plan.json", plan)).toEqual([]);
    expect(plan!.policies).toEqual([
      {
        type: "dev.ucp.lodging.policy.cancellation",
        refundability: "non_refundable",
        description: {
          plain: "Non-refundable rate: cancellation is not refunded.",
        },
      },
    ]);
    expect(
      ucpErrors(
        "lodging/policy_cancellation.json#/$defs/cancellation_item",
        (plan!.policies as unknown[])[0],
      ),
    ).toEqual([]);
    // Options come from the type and plan, not the free options.
    expect((product.variants as Record<string, unknown>[])[0]).toMatchObject({
      options: [
        { name: "Accommodation", label: "Suíte casal" },
        { name: "Rate plan", label: "Não reembolsável" },
      ],
      quantity_unit: { unit: "DAY", display_text: "night" },
    });
    expect(product.options).toEqual([
      { name: "Accommodation", values: [{ label: "Suíte casal" }] },
      { name: "Rate plan", values: [{ label: "Não reembolsável" }] },
    ]);
    // A quote lodging item does not leave through UCP.
    expect(
      toUcpLodgingProduct(item, [{ ...variant, priceAmount: null }], lodging),
    ).toBeNull();
  });

  it("validates capacity and plans with the UCP rules", () => {
    expect(
      AccommodationTypeInput.safeParse({
        title: "Quarto",
        capacity: { adults: 3, total: 2 },
      }).success,
    ).toBe(false);
    expect(
      AccommodationTypeInput.safeParse({
        title: "Quarto",
        capacity: { total: 0 },
      }).success,
    ).toBe(false);
    expect(
      AccommodationTypeInput.safeParse({
        title: "Quarto",
        capacity: { child_age_ranges: [{ ages: { min: 12, max: 2 } }] },
      }).success,
    ).toBe(false);
    expect(
      AccommodationTypeInput.parse({ title: "Quarto", capacity: { total: 2 } }),
    ).toMatchObject({ capacity: { total: 2 }, amenities: [], media: [] });
    expect(RatePlanInput.parse({ title: "Padrão" })).toEqual({
      title: "Padrão",
      refundability: "refundable",
      board: "room_only",
    });
    expect(
      RatePlanInput.safeParse({ title: "X", refundability: "maybe" }).success,
    ).toBe(false);
  });

  it("reads the house rules from the form and requires check-in and check-out to activate", () => {
    const data = new FormData();
    data.append("details.check_in_time", "14:00");
    data.append("details.check_out_time", "11:00");
    data.append("details.quiet_hours.opens", "22:00");
    data.append("details.quiet_hours.closes", "08:00");
    data.append("details.pets_allowed", "on");
    data.append("details.pets_allowed.present", "1");
    data.append("details.cleaning_fee", "150,00");
    const details = detailsFromForm("lodging", "general", data);
    expect(details).toEqual({
      check_in_time: "14:00",
      check_out_time: "11:00",
      quiet_hours: { opens: "22:00", closes: "08:00" },
      pets_allowed: true,
      cleaning_fee: 15000,
    });
    const active = detailsSchema("lodging", "general", { requireAll: true });
    expect(active.safeParse(details).success).toBe(true);
    expect(active.safeParse({ check_in_time: "14:00" }).success).toBe(false);
    expect(active.safeParse({ ...details, check_in_time: "2pm" }).success).toBe(
      false,
    );
  });
});
