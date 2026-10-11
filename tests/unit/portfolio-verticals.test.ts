import { describe, expect, it } from "vitest";

import { toUcpProduct, type SerializableItem } from "@/modules/portfolio/ucp";
import {
  detailsFromForm,
  detailsSchema,
  fieldsFor,
  isValidKind,
  listKinds,
} from "@/modules/portfolio/verticals";

import { ucpErrors } from "./support/ucp";

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

describe("Portfolio verticals (F5b)", () => {
  it("lists every kind of the pilot, corrected, and refuses lodging until F5c", () => {
    expect(listKinds().map((k) => k.value)).toEqual([
      "product:general",
      "service:general",
      "service:healthcare",
      "service:aesthetics",
      "service:beauty",
      "service:b2b_corporate",
      "real_estate:general",
      "event:general",
    ]);
    expect(isValidKind("lodging", "general")).toBe(false);
    expect(isValidKind("product", "healthcare")).toBe(false);
    // Every key is snake_case (UCP convention), nested keys included.
    for (const { value } of listKinds()) {
      const [type, vertical] = value.split(":");
      for (const f of fieldsFor(type!, vertical!)) {
        expect(f.key).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/);
      }
    }
  });

  it("reads the service healthcare form into UCP-style details", () => {
    const details = detailsFromForm(
      "service",
      "healthcare",
      form({
        "details.duration_minutes": "50",
        "details.callout_fee": "120,00",
        "details.specialties": "Ortodontia, Implantes",
        "details.requirements": "Trazer exames\nChegar 10 min antes",
        "details.includes_materials.present": "1",
        "details.professional_registry.type": "cro",
        "details.professional_registry.number": "12345",
        "details.professional_registry.region": "SP",
        "details.patient_type": "human",
        "details.emergency_service": "on",
        "details.emergency_service.present": "1",
        "details.service_area.coverage_type": "radius",
        "details.service_area.radius_meters": "5000",
      }),
    );
    expect(details).toEqual({
      duration_minutes: 50,
      callout_fee: 12000,
      specialties: ["Ortodontia", "Implantes"],
      requirements: ["Trazer exames", "Chegar 10 min antes"],
      includes_materials: false,
      professional_registry: { type: "cro", number: "12345", region: "SP" },
      patient_type: "human",
      emergency_service: true,
      service_area: { coverage_type: "radius", radius_meters: 5000 },
    });
    expect(
      detailsSchema("service", "healthcare").safeParse(details).success,
    ).toBe(true);
    // A field of another vertical is refused (strict).
    expect(
      detailsSchema("service", "healthcare").safeParse({
        treated_areas: ["Rosto"],
      }).success,
    ).toBe(false);
  });

  it("requires the mandatory details only for active items", () => {
    const draft = detailsSchema("real_estate", "general");
    const active = detailsSchema("real_estate", "general", {
      requireAll: true,
    });
    expect(draft.safeParse({ bedrooms: 2 }).success).toBe(true);
    expect(active.safeParse({ bedrooms: 2 }).success).toBe(false);
    const details = detailsFromForm(
      "real_estate",
      "general",
      form({
        "details.operation_type": "rent",
        "details.property_type": "apartment",
        "details.usable_area": "72,5",
        "details.condo_fee": "850,00",
        "details.amenities": [
          "co.guidu.amenity.pool",
          "dev.ucp.amenity.parking",
        ],
      }),
    );
    expect(details.usable_area).toEqual({
      unit: "MTK",
      display_text: "m²",
      scale: 2,
      value: 7250,
    });
    expect(active.safeParse(details).success).toBe(true);
    // The pilot's TEMPORARY moved to lodging (decision 5).
    expect(
      active.safeParse({ ...details, operation_type: "temporary" }).success,
    ).toBe(false);

    const event = detailsFromForm(
      "event",
      "general",
      form({ "details.starts_at": "2026-11-20T19:00" }),
    );
    expect(event).toEqual({ starts_at: "2026-11-20T19:00:00-03:00" });
    expect(
      detailsSchema("event", "general", { requireAll: true }).safeParse(event)
        .success,
    ).toBe(true);
  });

  it("sends the details in the UCP metadata under the co.guidu namespace", () => {
    const item: SerializableItem = {
      id: "f5b00000-0000-4000-8000-000000000001",
      title: "Limpeza de pele",
      handle: "limpeza-de-pele",
      description: { plain: "Sessão completa." },
      categories: [],
      media: [],
      tags: [],
      url: null,
      rating: null,
      priceDisplay: "price",
      itemType: "service",
      vertical: "aesthetics",
      details: { sessions_recommended: 4, recovery_time: "immediate" },
      status: "active",
      visibility: "public",
      aiDiscoveryEnabled: true,
    };
    const product = toUcpProduct(item, [
      {
        id: "f5b00000-0000-4000-8000-0000000000a1",
        title: "Sessão",
        sku: null,
        barcodes: [],
        priceAmount: 18000,
        listPriceAmount: null,
        currency: "BRL",
        quantityUnit: { unit: "C62", display_text: "sessão" },
        options: [],
        media: [],
        availabilityStatus: "in_stock",
        trackInventory: false,
        stockQuantity: null,
        allowBackorder: false,
      },
    ]);
    expect(product?.metadata).toEqual({
      "co.guidu.portfolio.service.aesthetics": {
        sessions_recommended: 4,
        recovery_time: "immediate",
      },
    });
    expect(ucpErrors("shopping/types/product.json", product)).toEqual([]);
  });
});
