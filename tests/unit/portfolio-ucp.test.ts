import { describe, expect, it } from "vitest";

import {
  isUcpVisible,
  type SerializableItem,
  type SerializableVariant,
  toUcpProduct,
  variantAvailability,
} from "@/modules/portfolio/ucp";

import { ucpErrors } from "./support/ucp";

const item: SerializableItem = {
  id: "8f3a2b1c-0000-4000-8000-000000000001",
  title: "Camiseta Básica",
  handle: "camiseta-basica",
  description: { plain: "Algodão 100%." },
  categories: [
    { value: "Vestuário > Camisetas", taxonomy: "merchant" },
    { value: "212", taxonomy: "google_product_category" },
  ],
  media: [
    { type: "image", url: "https://cdn.test/camiseta.jpg", alt_text: "Frente" },
  ],
  tags: ["algodão"],
  url: "https://loja.test/camiseta-basica",
  rating: { value: 4.6, scale_max: 5, count: 12 },
  priceDisplay: "price",
  status: "active",
  visibility: "public",
  aiDiscoveryEnabled: true,
};

const variant = (over: Partial<SerializableVariant>): SerializableVariant => ({
  id: "8f3a2b1c-0000-4000-8000-0000000000a1",
  title: "Azul / M",
  sku: "CAM-AZ-M",
  barcodes: [{ type: "EAN", value: "7891234567895" }],
  priceAmount: 4990,
  listPriceAmount: 5990,
  currency: "BRL",
  quantityUnit: null,
  options: [
    { name: "Cor", label: "Azul" },
    { name: "Tamanho", label: "M" },
  ],
  media: [],
  availabilityStatus: "in_stock",
  trackInventory: false,
  stockQuantity: null,
  allowBackorder: false,
  ...over,
});

describe("Portfolio → UCP Product (F5a)", () => {
  it("validates against the official UCP product schema", () => {
    const product = toUcpProduct(item, [
      variant({}),
      variant({
        id: "8f3a2b1c-0000-4000-8000-0000000000a2",
        title: "Preta / G",
        sku: "CAM-PR-G",
        priceAmount: 5490,
        listPriceAmount: null,
        options: [
          { name: "Cor", label: "Preta" },
          { name: "Tamanho", label: "G" },
        ],
        quantityUnit: { unit: "C62", display_text: "unidade" },
      }),
    ]);
    expect(product).not.toBeNull();
    expect(ucpErrors("shopping/types/product.json", product)).toEqual([]);
    // Sale bases the platform writes go out in English (I5).
    expect(
      (product!.variants as Record<string, unknown>[]).find(
        (v) => v.sku === "CAM-PR-G",
      )?.quantity_unit,
    ).toEqual({ unit: "C62", display_text: "unit" });
    expect(product).toMatchObject({
      handle: "camiseta-basica",
      price_range: {
        min: { amount: 4990, currency: "BRL" },
        max: { amount: 5490, currency: "BRL" },
      },
      options: [
        { name: "Cor", values: [{ label: "Azul" }, { label: "Preta" }] },
        { name: "Tamanho", values: [{ label: "M" }, { label: "G" }] },
      ],
    });
  });

  it("never exposes internal or AI governance fields", () => {
    const product = toUcpProduct(item, [variant({})])!;
    const text = JSON.stringify(product);
    for (const internal of [
      "visibility",
      "ai_",
      "stock_quantity",
      "track_inventory",
      "allow_backorder",
      "priority",
      "is_featured",
      "price_display",
    ]) {
      expect(text).not.toContain(`"${internal}`);
    }
    // `status` appears only inside the UCP availability of each variant.
    expect(Object.keys(product)).not.toContain("status");
  });

  it("derives availability from stock and leaves quote items out", () => {
    expect(
      variantAvailability(variant({ trackInventory: true, stockQuantity: 0 })),
    ).toEqual({ available: false, status: "out_of_stock" });
    expect(
      variantAvailability(
        variant({
          trackInventory: true,
          stockQuantity: 0,
          allowBackorder: true,
        }),
      ),
    ).toEqual({ available: true, status: "backorder" });
    expect(toUcpProduct(item, [variant({ priceAmount: null })])).toBeNull();
    expect(isUcpVisible({ ...item, priceDisplay: "quote" })).toBe(false);
    expect(isUcpVisible({ ...item, aiDiscoveryEnabled: false })).toBe(false);
    expect(isUcpVisible({ ...item, status: "draft" })).toBe(false);
    expect(isUcpVisible(item)).toBe(true);
  });

  it("falls back to the title when the item has no description", () => {
    const product = toUcpProduct({ ...item, description: {} }, [variant({})]);
    expect(product?.description).toEqual({ plain: "Camiseta Básica" });
    expect(ucpErrors("shopping/types/product.json", product)).toEqual([]);
  });
});
