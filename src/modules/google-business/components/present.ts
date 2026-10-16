import "server-only";

import type { AnalysisFinding, AnalysisStatus } from "../analyses/contract";
import {
  AUTOMATION_AREAS,
  type AutomationArea,
  type EffectiveArea,
} from "../areas";
import {
  type AutomationView,
  insightRuns,
  type RunView,
  tipsOf,
} from "../server/automation";

/**
 * Texts of the automation page rendered on the server (GB1a): findings,
 * analysis labels and metric names come as message keys from any analysis
 * of the registry (GB1a or GB1b, any namespace), so the server translates
 * them with the root translator and the screen gets plain strings. A key
 * without a translation falls back to a generic text, never to the key.
 */

export type Translator = ((
  key: string,
  values?: Record<string, string | number>,
) => string) & { has(key: string): boolean };

export type FindingText = Readonly<{
  key: string;
  severity: AnalysisFinding["severity"];
  title: string;
  detail: string;
  current: string | null;
  suggested: string | null;
}>;

export type MetricText = Readonly<{
  name: string;
  label: string;
  value: string;
}>;

export type RunText = Readonly<{
  key: string;
  area: string;
  label: string;
  status: AnalysisStatus;
  findings: readonly FindingText[];
  metrics: readonly MetricText[];
}>;

export type AreaText = EffectiveArea &
  Readonly<{
    tips: readonly FindingText[];
    running: boolean;
    metrics: readonly MetricText[];
  }>;

export type AutomationPageData = Readonly<{
  location: AutomationView["location"];
  mode: AutomationView["mode"];
  canManage: boolean;
  ceiling: AutomationView["ceiling"];
  configured: number;
  totalAreas: number;
  diagnosis: AutomationView["diagnosis"];
  points: number;
  areas: readonly AreaText[];
  insights: readonly RunText[];
  running: boolean;
}>;

const HIDDEN_METRICS = new Set(["itemsOk", "itemsTotal"]);
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

function safe(
  t: Translator,
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
): string {
  try {
    return t.has(key) ? t(key, values) : fallback;
  } catch {
    return fallback;
  }
}

export function presentFinding(t: Translator, f: AnalysisFinding): FindingText {
  return {
    key: f.key,
    severity: f.severity,
    title: safe(
      t,
      f.titleKey,
      t("googleBusiness.findings.generic.title"),
      f.values as Record<string, string | number> | undefined,
    ),
    detail: safe(
      t,
      f.detailKey,
      "",
      f.values as Record<string, string | number> | undefined,
    ),
    current: f.current ?? null,
    suggested: f.suggested ?? null,
  };
}

export function presentMetrics(
  t: Translator,
  metrics: Readonly<Record<string, number | null>>,
  format: (value: number) => string,
): MetricText[] {
  return Object.entries(metrics)
    .filter(([name]) => !HIDDEN_METRICS.has(name))
    .map(([name, value]) => ({
      name,
      label: safe(t, `googleBusiness.metrics.${name}`, name),
      value: value === null ? "—" : format(value),
    }));
}

function sortFindings(list: readonly FindingText[]): FindingText[] {
  return [...list].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

function runText(
  t: Translator,
  run: RunView,
  format: (v: number) => string,
): RunText {
  return {
    key: run.key,
    area: run.area,
    label: safe(t, run.labelKey, run.key),
    status: run.status,
    findings: sortFindings(run.findings.map((f) => presentFinding(t, f))),
    metrics: presentMetrics(t, run.metrics, format),
  };
}

const busy = (status: AnalysisStatus) =>
  status === "pending" || status === "running";

export function presentAutomation(
  view: AutomationView,
  t: Translator,
  format: (value: number) => string,
): AutomationPageData {
  const areas = view.areas.map((area): AreaText => {
    const runs = view.runs.filter((r) => r.area === area.area);
    return {
      ...area,
      tips: sortFindings(
        tipsOf(area.area as AutomationArea, view.runs).map((f) =>
          presentFinding(t, f),
        ),
      ),
      running: runs.some((r) => busy(r.status)),
      metrics: runs
        .filter((r) => r.status === "done")
        .flatMap((r) => presentMetrics(t, r.metrics, format)),
    };
  });
  const covered = new Set<string>(AUTOMATION_AREAS);
  const others = [
    ...insightRuns(view.runs),
    ...view.runs.filter(
      (r) => !covered.has(r.area) && !insightRuns([r]).length,
    ),
  ];
  return {
    location: view.location,
    mode: view.mode,
    canManage: view.canManage,
    ceiling: view.ceiling,
    configured: view.configured,
    totalAreas: AUTOMATION_AREAS.length,
    diagnosis: view.diagnosis,
    points: view.points,
    areas,
    insights: others.map((r) => runText(t, r, format)),
    running: view.runs.some((r) => busy(r.status)),
  };
}
