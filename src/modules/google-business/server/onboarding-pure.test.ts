import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LocationSnapshot } from "../analyses/contract";
import { normalizeAddress, sameAddress, unitFromSnapshot } from "./onboarding";

const ficha = {
  name: "Padaria",
  phone: "+551130000000",
  address: {
    lines: ["Rua das Flores, 120"],
    locality: "São Paulo",
    administrativeArea: "SP",
    postalCode: "01001-000",
    countryCode: "BR",
  },
  latitude: -23.5,
  longitude: -46.6,
  timeZone: null,
  regularHours: [{ day: 0, open: "08:00", close: "12:00" }],
  specialHours: [
    { date: "2026-12-25", closed: true, open: null, close: null },
    { date: "2026-12-24", closed: false, open: "08:00", close: "12:00" },
  ],
} as unknown as LocationSnapshot;

describe("unit of the onboarding", () => {
  it("normalizes addresses without accents or punctuation", () => {
    expect(normalizeAddress("Av. São João, 1.000")).toBe("av sao joao 1 000");
  });

  it("finds the unit with the same address", () => {
    expect(
      sameAddress(ficha, {
        street_address: "rua das flores 120",
        address_locality: "Sao Paulo",
      }),
    ).toBe(true);
    expect(
      sameAddress(ficha, {
        street_address: "Rua das Flores, 120",
        address_locality: "Campinas",
      }),
    ).toBe(false);
    expect(
      sameAddress(ficha, {
        street_address: "Rua das Flores, 12",
        address_locality: "São Paulo",
      }),
    ).toBe(false);
    expect(sameAddress(ficha, { street_address: "" })).toBe(false);
  });

  it("builds the unit from the ficha", () => {
    const unit = unitFromSnapshot(ficha, "America/Sao_Paulo");
    expect(unit).toMatchObject({
      name: "Padaria",
      timezone: "America/Sao_Paulo",
      address: {
        street_address: "Rua das Flores, 120",
        address_country: "BR",
        phone_number: "+551130000000",
      },
      geo: { latitude: -23.5, longitude: -46.6 },
      hours: [{ day: "sunday", opens: "08:00", closes: "12:00" }],
    });
    expect(unit.exception_hours).toEqual([
      { valid_from: "2026-12-25", valid_through: "2026-12-25" },
      {
        valid_from: "2026-12-24",
        valid_through: "2026-12-24",
        opens: "08:00",
        closes: "12:00",
      },
    ]);
  });
});
