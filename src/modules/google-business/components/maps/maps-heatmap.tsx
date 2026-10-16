"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { RankMatrix } from "../../maps/metrics";

/**
 * Heat map of the grid (GB1b): one square per search point, with the
 * position of the unit at that point; the middle square is the unit.
 * Colours come from the status tokens of ADR 0021 (green top 3, amber 4–10,
 * red 11–20, grey outside the top 20), and every square has its own label.
 */

export type RankBand = "top3" | "visible" | "buried" | "none";

export function rankBand(rank: number | null): RankBand {
  if (rank === null || rank < 1 || rank > 20) return "none";
  if (rank <= 3) return "top3";
  if (rank <= 10) return "visible";
  return "buried";
}

const BAND_CLASSES: Record<RankBand, string> = {
  top3: "bg-success-bg border-success-border text-success-text",
  visible: "bg-warning-bg border-warning-border text-warning-text",
  buried: "bg-danger-bg border-danger-border text-danger-text",
  none: "bg-surface-inset border-border text-text-secondary",
};

/** Static classes, so Tailwind sees every grid size the plans allow. */
const GRID_COLUMNS: Record<number, string> = {
  3: "grid-cols-3",
  5: "grid-cols-5",
  7: "grid-cols-7",
  9: "grid-cols-9",
  11: "grid-cols-11",
  13: "grid-cols-13",
};

const BAND_BADGES = {
  top3: "success",
  visible: "warning",
  buried: "danger",
  none: "neutral",
} as const;

export function MapsHeatmap({
  ranks,
  className,
}: Readonly<{ ranks: RankMatrix; className?: string }>) {
  const t = useTranslations("gbIntelligence.maps");
  const size = ranks.length;
  const middle = (size - 1) / 2;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        role="grid"
        aria-label={t("heatmapTitle")}
        data-testid="maps-heatmap"
        className={cn("grid w-full max-w-md gap-1", GRID_COLUMNS[size])}
      >
        {ranks.map((row, rowIndex) => (
          <div key={rowIndex} role="row" className="contents">
            {row.map((rank, columnIndex) => {
              const band = rankBand(rank);
              const center = rowIndex === middle && columnIndex === middle;
              return (
                <div
                  key={columnIndex}
                  role="gridcell"
                  data-band={band}
                  data-center={center ? "true" : undefined}
                  aria-label={t("cell", {
                    row: rowIndex + 1,
                    column: columnIndex + 1,
                    rank:
                      band === "none" || rank === null ? "none" : String(rank),
                  })}
                  className={cn(
                    "rounded-inner text-12 flex aspect-square items-center justify-center border font-semibold tabular-nums",
                    BAND_CLASSES[band],
                    center && "ring-primary ring-2 ring-offset-1",
                  )}
                >
                  {band === "none" ? "–" : rank}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="flex flex-wrap gap-2" aria-label={t("heatmapTitle")}>
        {(Object.keys(BAND_BADGES) as RankBand[]).map((band) => (
          <li key={band}>
            <Badge variant={BAND_BADGES[band]}>{t(`legend.${band}`)}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
