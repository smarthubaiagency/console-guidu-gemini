"use client";

import { Flag, Gauge, MapPin, Medal, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { SectionHeader } from "@/components/patterns/section-header";
import { StatCard } from "@/components/patterns/stat-card";
import { TagList } from "@/components/patterns/tag-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ScoreDimension } from "../../maps/score";
import type { MapsHealthView, MapsKeywordView } from "../../maps/view";
import { MapsHeatmap } from "./maps-heatmap";

/**
 * Saúde no Maps of a unit (GB1b, especificação §6.2), built only from the
 * model components (ADR 0021): the score with its math, SoLV, average
 * position, the heat map of each keyword and the competitors of the radius.
 * Plain props (`MapsHealthView`, from `loadMapsHealthView` on the server),
 * no data access, no writes: ready to be plugged into the automation page.
 */

function scoreBadge(
  score: number | null,
): "success" | "warning" | "danger" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 60) return "success";
  if (score >= 40) return "warning";
  return "danger";
}

function formulaValues(
  dimension: ScoreDimension,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(dimension.inputs).map(([key, value]) => [
      key,
      value === null ? "-" : typeof value === "boolean" ? String(value) : value,
    ]),
  );
}

function ScoreBreakdown({
  score,
  breakdown,
}: Readonly<{ score: number | null; breakdown: readonly ScoreDimension[] }>) {
  const t = useTranslations("gbIntelligence.maps");
  const format = useFormatter();
  const number = (value: number) =>
    format.number(value, { maximumFractionDigits: 1 });
  return (
    <section className="flex flex-col gap-4" data-testid="maps-breakdown">
      <SectionHeader
        level={3}
        title={t("breakdownTitle")}
        description={t("breakdownTotal", { score: score ?? 0 })}
      />
      <ul className="flex flex-col gap-3">
        {breakdown.map((dimension) => (
          <li key={dimension.key}>
            <Card variant="inset" className="gap-2 px-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-14 text-text font-medium">
                  {t(`dimensions.${dimension.key}`)}
                </span>
                <span className="text-14 text-text font-semibold tabular-nums">
                  {t("points", {
                    points: number(dimension.points),
                    max: dimension.max,
                  })}
                </span>
              </div>
              <Progress
                aria-label={t(`dimensions.${dimension.key}`)}
                value={Math.round((dimension.points / dimension.max) * 100)}
                className="h-1.5"
              />
              <p className="text-12 text-text-secondary">
                {t(`formulas.${dimension.key}`, formulaValues(dimension))}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeywordDetail({
  keyword,
  radiusKm,
}: Readonly<{ keyword: MapsKeywordView; radiusKm: number }>) {
  const t = useTranslations("gbIntelligence.maps");
  const format = useFormatter();
  const number = (value: number) =>
    format.number(value, { maximumFractionDigits: 1 });
  return (
    <div className="flex flex-col gap-6">
      <div
        className="grid gap-4 md:grid-cols-3"
        data-testid="maps-keyword-stats"
      >
        <StatCard
          variant="plain"
          icon={<Medal className="size-4" />}
          label={t("solv")}
          value={`${number(keyword.solv)}%`}
          caption={t("solvHint")}
        />
        <StatCard
          variant="plain"
          icon={<Gauge className="size-4" />}
          label={t("averageRank")}
          value={
            keyword.averageRank === null ? "–" : number(keyword.averageRank)
          }
          caption={t("averageRankHint")}
        />
        <StatCard
          variant="plain"
          icon={<MapPin className="size-4" />}
          label={t("found")}
          value={t("foundValue", {
            found: keyword.foundPoints,
            total: keyword.totalPoints,
          })}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <SectionHeader
            level={3}
            title={t("heatmapTitle")}
            description={t("heatmapCaption", {
              size: keyword.gridSize,
              radius: number(radiusKm),
            })}
          />
          <MapsHeatmap ranks={keyword.ranks} />
          {keyword.neighborhoods.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-12 text-text-secondary">
                {t("neighborhoods")}
              </span>
              <TagList tags={keyword.neighborhoods} />
            </div>
          ) : null}
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader
            level={3}
            title={t("competitorsTitle")}
            description={t("competitorsDescription", {
              keyword: keyword.keyword,
            })}
          />
          <div className="overflow-x-auto">
            <Table variant="soft" data-testid="maps-competitors">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead className="text-right">
                    {t("columns.rating")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("columns.reviews")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("columns.appearances")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("columns.averageRank")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keyword.competitors.slice(0, 10).map((competitor) => (
                  <TableRow key={competitor.placeId ?? competitor.name}>
                    <TableCell className="max-w-56">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate">{competitor.name}</span>
                        {competitor.isReference ? (
                          <Badge variant="info">{t("reference")}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {competitor.rating === null ? (
                        "–"
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Star aria-hidden className="size-3" />
                          {number(competitor.rating)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {competitor.reviews === null
                        ? "–"
                        : format.number(competitor.reviews)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {competitor.appearances}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(competitor.averageRank)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}

export function MapsHealthPanel({
  view,
}: Readonly<{ view: MapsHealthView | null }>) {
  const t = useTranslations("gbIntelligence.maps");
  const format = useFormatter();
  const [keywordIndex, setKeywordIndex] = useState("0");

  if (!view) {
    return (
      <Card variant="panel" className="px-4 sm:px-6" data-testid="maps-health">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapPin />
            </EmptyMedia>
            <EmptyDescription>{t("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium" });
  const number = (value: number) =>
    format.number(value, { maximumFractionDigits: 1 });

  return (
    <Card
      variant="panel"
      className="gap-8 px-4 sm:px-6"
      data-testid="maps-health"
    >
      <SectionHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view.isBaseline ? (
              <Badge variant="info">
                <Flag />
                {t("baselineBadge")}
              </Badge>
            ) : null}
            <Badge variant="neutral">
              {t("measuredAt", { date: date(view.measuredAt) })}
            </Badge>
          </div>
        }
      />

      <CardContent className="flex flex-col gap-8 px-0">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4">
            <StatCard
              icon={<Gauge className="size-4" />}
              label={t("score")}
              value={
                <span
                  data-testid="maps-score"
                  className="flex items-center gap-3"
                >
                  {t("scoreValue", { score: view.score ?? 0 })}
                  <Badge variant={scoreBadge(view.score)}>
                    {view.score ?? 0}
                  </Badge>
                </span>
              }
              caption={
                view.baseline
                  ? t("baselineCompare", {
                      date: date(view.baseline.measuredAt),
                      score: view.baseline.score ?? "-",
                      solv: number(view.baseline.solv),
                    })
                  : undefined
              }
            />
            {view.costEstimateMicros > 0 ? (
              <p className="text-12 text-text-secondary">
                {t("cost", {
                  calls: view.apiCalls,
                  cost: format.number(view.costEstimateMicros / 1_000_000, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4,
                  }),
                })}
              </p>
            ) : null}
          </div>
          <div className="lg:col-span-2">
            <ScoreBreakdown score={view.score} breakdown={view.breakdown} />
          </div>
        </div>

        {view.keywords.length > 1 ? (
          <Tabs
            value={keywordIndex}
            onValueChange={setKeywordIndex}
            className="gap-6"
          >
            <TabsList variant="segmented" className="w-full">
              {view.keywords.map((keyword, index) => (
                <TabsTrigger key={keyword.keyword} value={String(index)}>
                  <span className="truncate">{keyword.keyword}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {view.keywords.map((keyword, index) => (
              <TabsContent key={keyword.keyword} value={String(index)}>
                <KeywordDetail keyword={keyword} radiusKm={view.radiusKm} />
              </TabsContent>
            ))}
          </Tabs>
        ) : view.keywords[0] ? (
          <KeywordDetail keyword={view.keywords[0]} radiusKm={view.radiusKm} />
        ) : null}
      </CardContent>
    </Card>
  );
}
