import { describe, expect, it } from "vitest";

import {
  buildGrid,
  destinationPoint,
  gridStepKm,
  haversineKm,
  isValidGridSize,
} from "./geo";

const SAO_PAULO = { latitude: -23.5505, longitude: -46.6333 };
const RIO = { latitude: -22.9068, longitude: -43.1729 };

describe("Haversine and the map grid (GB1b)", () => {
  it("measures great-circle distances", () => {
    expect(haversineKm(SAO_PAULO, SAO_PAULO)).toBe(0);
    // São Paulo to Rio de Janeiro: about 361 km in a straight line.
    expect(haversineKm(SAO_PAULO, RIO)).toBeGreaterThan(355);
    expect(haversineKm(SAO_PAULO, RIO)).toBeLessThan(365);
    // One degree of latitude is about 111.2 km.
    expect(
      haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeCloseTo(111.19, 1);
  });

  it("places a point at the asked distance and bearing", () => {
    const north = destinationPoint(SAO_PAULO, 0, 5);
    expect(north.latitude).toBeGreaterThan(SAO_PAULO.latitude);
    expect(north.longitude).toBeCloseTo(SAO_PAULO.longitude, 6);
    expect(haversineKm(SAO_PAULO, north)).toBeCloseTo(5, 6);
    const east = destinationPoint(SAO_PAULO, 90, 3.2);
    expect(east.longitude).toBeGreaterThan(SAO_PAULO.longitude);
    expect(haversineKm(SAO_PAULO, east)).toBeCloseTo(3.2, 6);
  });

  it("builds the 7×7 grid with a 5 km radius around the unit", () => {
    const grid = buildGrid(SAO_PAULO, 7, 5);
    expect(grid).toHaveLength(49);
    const center = grid[24]!;
    expect(center).toMatchObject({ row: 3, column: 3, ...SAO_PAULO });
    // Row-major from north-west: row 0 is north, column 0 is west.
    expect(grid[0]!.latitude).toBeGreaterThan(center.latitude);
    expect(grid[0]!.longitude).toBeLessThan(center.longitude);
    expect(grid[48]!.latitude).toBeLessThan(center.latitude);
    expect(grid[48]!.longitude).toBeGreaterThan(center.longitude);
    // The middle of each edge is at the radius.
    for (const index of [3, 21, 27, 45]) {
      expect(haversineKm(center, grid[index]!)).toBeCloseTo(5, 2);
    }
    // Neighbours are one step apart: 2 × 5 / 6 km.
    const step = gridStepKm(7, 5);
    expect(step).toBeCloseTo(1.6667, 4);
    expect(haversineKm(grid[24]!, grid[25]!)).toBeCloseTo(step, 2);
    expect(haversineKm(grid[24]!, grid[17]!)).toBeCloseTo(step, 2);
    // Corners at radius × √2.
    expect(haversineKm(center, grid[0]!)).toBeCloseTo(5 * Math.SQRT2, 1);
  });

  it("keeps the spacing right far from the equator", () => {
    const oslo = { latitude: 59.9139, longitude: 10.7522 };
    const grid = buildGrid(oslo, 5, 3);
    const step = gridStepKm(5, 3);
    expect(haversineKm(grid[12]!, grid[13]!)).toBeCloseTo(step, 2);
    expect(haversineKm(grid[12]!, grid[7]!)).toBeCloseTo(step, 2);
  });

  it("rounds coordinates to 7 decimals and refuses bad sizes", () => {
    for (const point of buildGrid(SAO_PAULO, 3, 2)) {
      expect(
        point.latitude.toString().split(".")[1]?.length ?? 0,
      ).toBeLessThanOrEqual(7);
    }
    expect(isValidGridSize(7)).toBe(true);
    expect(isValidGridSize(8)).toBe(false);
    expect(isValidGridSize(1)).toBe(false);
    expect(isValidGridSize(15)).toBe(false);
    expect(() => buildGrid(SAO_PAULO, 6, 5)).toThrow(/grid size/);
    expect(() => buildGrid(SAO_PAULO, 7, 0)).toThrow(/radius/);
  });
});
