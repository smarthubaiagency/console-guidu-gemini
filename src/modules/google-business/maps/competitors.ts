import type { RankMatrix } from "./metrics";
import type { MapsPointResult, MapsSearchItem } from "./provider/types";

/**
 * From the searches of one keyword to the position of the unit at each
 * point and the competitors of the radius (GB1b, especificação §6.2).
 * Competitors are ranked by how many points they show up in and then by
 * their mean position: the 20 strongest of the grid ("Competitor Radius
 * Mapping" of `AgriciDaniel/claude-seo`, MIT, `skills/seo-maps/SKILL.md`).
 */

export const COMPETITORS_PER_KEYWORD = 20;
export const NEIGHBORHOODS_PER_KEYWORD = 8;

export type CompetitorStat = Readonly<{
  placeId: string | null;
  name: string;
  rating: number | null;
  reviews: number | null;
  categories: readonly string[];
  /** Points of the grid where it shows up. */
  appearances: number;
  /** Mean position where it shows up, two decimals. */
  averageRank: number;
}>;

export type KeywordGridResult = Readonly<{
  ranks: RankMatrix;
  competitors: readonly CompetitorStat[];
  /** Neighbourhoods where competitors beat the unit (vocabulary to use). */
  neighborhoods: readonly string[];
}>;

export type Target = Readonly<{ placeId: string | null; name: string }>;

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isTarget(item: MapsSearchItem, target: Target): boolean {
  if (target.placeId && item.placeId) return item.placeId === target.placeId;
  return normalizeName(item.name) === normalizeName(target.name);
}

function competitorKey(item: MapsSearchItem): string {
  return item.placeId ?? item.cid ?? `name:${normalizeName(item.name)}`;
}

export function analyseKeywordGrid(
  points: readonly MapsPointResult[],
  size: number,
  target: Target,
): KeywordGridResult {
  const ranks: (number | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );
  const stats = new Map<
    string,
    { item: MapsSearchItem; appearances: number; rankSum: number }
  >();
  const neighborhoods = new Map<string, number>();

  for (const point of points) {
    if (point.row >= size || point.column >= size) continue;
    const own = point.items.find((item) => isTarget(item, target));
    ranks[point.row]![point.column] = own ? own.rank : null;
    for (const item of point.items) {
      if (isTarget(item, target)) continue;
      const key = competitorKey(item);
      const entry = stats.get(key) ?? { item, appearances: 0, rankSum: 0 };
      entry.appearances += 1;
      entry.rankSum += item.rank;
      stats.set(key, entry);
      // Where the unit is out of the top 3, the neighbourhoods of who is in.
      if ((!own || own.rank > 3) && item.rank <= 3 && item.neighborhood) {
        const name = item.neighborhood.trim();
        if (name) neighborhoods.set(name, (neighborhoods.get(name) ?? 0) + 1);
      }
    }
  }

  const competitors = [...stats.values()]
    .map(({ item, appearances, rankSum }): CompetitorStat => ({
      placeId: item.placeId,
      name: item.name,
      rating: item.rating,
      reviews: item.reviews,
      categories: item.categories.slice(0, 5),
      appearances,
      averageRank: Math.round((rankSum / appearances) * 100) / 100,
    }))
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        a.averageRank - b.averageRank ||
        a.name.localeCompare(b.name),
    )
    .slice(0, COMPETITORS_PER_KEYWORD);

  return {
    ranks,
    competitors,
    neighborhoods: [...neighborhoods.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, NEIGHBORHOODS_PER_KEYWORD)
      .map(([name]) => name),
  };
}

/**
 * Competitors in the top 10 now that were nowhere in the previous
 * measurement of the same keyword ("concorrente novo no raio").
 */
export function newCompetitors(
  current: readonly CompetitorStat[],
  previous: readonly Pick<CompetitorStat, "placeId" | "name">[],
): CompetitorStat[] {
  const known = new Set(
    previous.map((c) => c.placeId ?? `name:${normalizeName(c.name)}`),
  );
  return current
    .slice(0, 10)
    .filter((c) => !known.has(c.placeId ?? `name:${normalizeName(c.name)}`));
}
