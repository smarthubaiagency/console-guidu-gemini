import { describe, expect, it } from "vitest";

import {
  analyseKeywordGrid,
  isTarget,
  newCompetitors,
  normalizeName,
} from "./competitors";
import { buildGrid } from "./geo";
import { gridMetrics } from "./metrics";
import { createFakeMapsProvider } from "./provider/fake";
import type { MapsPointResult, MapsSearchItem } from "./provider/types";

function item(
  rank: number,
  name: string,
  extra: Partial<MapsSearchItem> = {},
): MapsSearchItem {
  return {
    rank,
    placeId: `id-${normalizeName(name).replace(/ /g, "-")}`,
    cid: null,
    name,
    rating: 4.5,
    reviews: 10,
    categories: [],
    neighborhood: null,
    ...extra,
  };
}

const TARGET = { placeId: "id-me", name: "Minha Loja" };

describe("position per point and competitors of the radius (GB1b)", () => {
  it("reads the unit's position at each point and ranks the competitors", () => {
    const points: MapsPointResult[] = [
      {
        row: 0,
        column: 0,
        items: [
          item(1, "Rival A", { neighborhood: "Centro" }),
          item(2, "Minha Loja", { placeId: "id-me" }),
        ],
      },
      {
        row: 0,
        column: 1,
        items: [
          item(1, "Rival A", { neighborhood: "Centro" }),
          item(2, "Rival B", { neighborhood: "Vila" }),
          item(5, "Minha Loja", { placeId: "id-me" }),
        ],
      },
      {
        row: 1,
        column: 0,
        items: [
          item(1, "Minha Loja", { placeId: "id-me" }),
          item(2, "Rival B"),
        ],
      },
      {
        row: 1,
        column: 1,
        items: [item(3, "Rival C", { neighborhood: "Vila" })],
      },
    ];
    const result = analyseKeywordGrid(points, 2, TARGET);
    expect(result.ranks).toEqual([
      [2, 5],
      [1, null],
    ]);
    expect(
      result.competitors.map((c) => [c.name, c.appearances, c.averageRank]),
    ).toEqual([
      ["Rival A", 2, 1],
      ["Rival B", 2, 2],
      ["Rival C", 1, 3],
    ]);
    // Where the unit is out of the top 3, who is in shows the neighbourhoods.
    expect(result.neighborhoods).toEqual(["Vila", "Centro"]);
  });

  it("matches the unit by place id, else by name", () => {
    expect(isTarget(item(1, "Minha Loja", { placeId: "other" }), TARGET)).toBe(
      false,
    );
    expect(isTarget(item(1, "Minha Loja", { placeId: null }), TARGET)).toBe(
      true,
    );
    expect(
      isTarget(item(1, "MINHA  LOJA!", { placeId: null }), {
        placeId: null,
        name: "Minha Loja",
      }),
    ).toBe(true);
  });

  it("detects competitors new in the top 10", () => {
    const current = [
      {
        placeId: "a",
        name: "A",
        rating: 4,
        reviews: 1,
        categories: [],
        appearances: 9,
        averageRank: 2,
      },
      {
        placeId: "n",
        name: "Novo",
        rating: 5,
        reviews: 3,
        categories: [],
        appearances: 5,
        averageRank: 4,
      },
    ];
    expect(
      newCompetitors(current, [{ placeId: "a", name: "A" }]).map((c) => c.name),
    ).toEqual(["Novo"]);
    expect(newCompetitors(current, current)).toEqual([]);
  });

  it("keeps the top 20 of a full fake grid", async () => {
    const provider = createFakeMapsProvider();
    const points = buildGrid({ latitude: -23.55, longitude: -46.63 }, 7, 5);
    const searched = await provider.searchGrid({
      keyword: "dentista",
      points,
      languageCode: "pt",
      target: TARGET,
    });
    const result = analyseKeywordGrid(searched, 7, TARGET);
    expect(result.competitors).toHaveLength(20);
    const metrics = gridMetrics(result.ranks);
    expect(metrics.totalPoints).toBe(49);
    // The fake puts the unit in the top 3 at the centre and weaker to the east.
    expect(result.ranks[3]![3]).toBeLessThanOrEqual(3);
    expect(metrics.weakestDirection).toMatch(/e/);
    // Deterministic.
    const again = analyseKeywordGrid(
      await provider.searchGrid({
        keyword: "dentista",
        points,
        languageCode: "pt",
        target: TARGET,
      }),
      7,
      TARGET,
    );
    expect(again).toEqual(result);
  });
});
