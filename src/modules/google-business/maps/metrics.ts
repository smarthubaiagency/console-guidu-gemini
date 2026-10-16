/**
 * Numbers of one keyword on the grid (GB1b, especificação §6.2).
 *
 * SoLV, average rank and the visibility score follow the definitions of
 * `AgriciDaniel/claude-seo` (MIT, `skills/seo/references/maps-geo-grid.md`;
 * SoLV is the "Share of Local Voice" metric popularised by Local Falcon):
 *
 * - SoLV = points in the top 3 / points of the grid × 100;
 * - average rank = mean position over the points where the business shows
 *   up (null when it shows up nowhere), always shown next to how many
 *   points it was found in;
 * - visibility = (3 × points in the top 3 + 1 × points in 4–10) /
 *   (3 × points) × 100.
 */

/** Position per point, row-major from north-west; null = not in the results. */
export type RankMatrix = ReadonlyArray<ReadonlyArray<number | null>>;

export type Direction = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export type GridMetrics = Readonly<{
  totalPoints: number;
  foundPoints: number;
  top3Points: number;
  /** 0–100, two decimals. */
  solv: number;
  /** Two decimals, or null when not found anywhere. */
  averageRank: number | null;
  /** 0–100, two decimals. */
  visibility: number;
  /** Compass sector with the worst positions, or null when all are equal. */
  weakestDirection: Direction | null;
}>;

/** Depth of the search: a business below it counts as not found. */
export const SEARCH_DEPTH = 20;

const round2 = (value: number) => Math.round(value * 100) / 100;

function flatten(ranks: RankMatrix): (number | null)[] {
  return ranks.flatMap((row) =>
    row.map((rank) =>
      rank !== null &&
      Number.isInteger(rank) &&
      rank >= 1 &&
      rank <= SEARCH_DEPTH
        ? rank
        : null,
    ),
  );
}

export function computeSolv(ranks: RankMatrix): number {
  const all = flatten(ranks);
  if (all.length === 0) return 0;
  const top3 = all.filter((rank) => rank !== null && rank <= 3).length;
  return round2((top3 / all.length) * 100);
}

export function computeAverageRank(ranks: RankMatrix): number | null {
  const found = flatten(ranks).filter((rank): rank is number => rank !== null);
  if (found.length === 0) return null;
  return round2(found.reduce((sum, rank) => sum + rank, 0) / found.length);
}

export function computeVisibility(ranks: RankMatrix): number {
  const all = flatten(ranks);
  if (all.length === 0) return 0;
  const points = all.reduce<number>((sum, rank) => {
    if (rank === null) return sum;
    if (rank <= 3) return sum + 3;
    if (rank <= 10) return sum + 1;
    return sum;
  }, 0);
  return round2((points / (3 * all.length)) * 100);
}

const SECTORS: readonly Direction[] = [
  "e",
  "ne",
  "n",
  "nw",
  "w",
  "sw",
  "s",
  "se",
];

/** Sector of a point relative to the centre of the grid. */
export function directionOf(
  row: number,
  column: number,
  size: number,
): Direction | null {
  const middle = (size - 1) / 2;
  const dx = column - middle;
  const dy = middle - row;
  if (dx === 0 && dy === 0) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const index = Math.round((((angle % 360) + 360) % 360) / 45) % 8;
  return SECTORS[index] ?? null;
}

/**
 * Sector with the worst mean position (not found counts as depth + 1);
 * null when every sector is the same.
 */
export function weakestDirection(ranks: RankMatrix): Direction | null {
  const size = ranks.length;
  const totals = new Map<Direction, { sum: number; count: number }>();
  ranks.forEach((row, rowIndex) =>
    row.forEach((rank, columnIndex) => {
      const direction = directionOf(rowIndex, columnIndex, size);
      if (!direction) return;
      const value =
        rank !== null && rank >= 1 && rank <= SEARCH_DEPTH
          ? rank
          : SEARCH_DEPTH + 1;
      const entry = totals.get(direction) ?? { sum: 0, count: 0 };
      entry.sum += value;
      entry.count += 1;
      totals.set(direction, entry);
    }),
  );
  let worst: Direction | null = null;
  let worstMean = -Infinity;
  let best = Infinity;
  for (const direction of SECTORS) {
    const entry = totals.get(direction);
    if (!entry) continue;
    const mean = entry.sum / entry.count;
    best = Math.min(best, mean);
    if (mean > worstMean) {
      worstMean = mean;
      worst = direction;
    }
  }
  return worst !== null && worstMean > best ? worst : null;
}

export function gridMetrics(ranks: RankMatrix): GridMetrics {
  const all = flatten(ranks);
  return {
    totalPoints: all.length,
    foundPoints: all.filter((rank) => rank !== null).length,
    top3Points: all.filter((rank) => rank !== null && rank <= 3).length,
    solv: computeSolv(ranks),
    averageRank: computeAverageRank(ranks),
    visibility: computeVisibility(ranks),
    weakestDirection: weakestDirection(ranks),
  };
}
