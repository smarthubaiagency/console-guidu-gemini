import type {
  AnalysisArea,
  AnalysisFinding,
  AnalysisResult,
  FindingSeverity,
} from "../contract";

/**
 * Verifiable checklist items (especificação §6.1): each item is in order or
 * not; an item the provider gave no data for is left out, never guessed.
 * Each analysis reports `itemsOk` and `itemsTotal`, which the page adds up
 * into "X de Y itens em ordem".
 */

export type ChecklistItem = Readonly<{
  key: string;
  /** null: no data to judge, the item is not counted. */
  ok: boolean | null;
  severity: FindingSeverity;
  values?: Readonly<Record<string, string | number>>;
  current?: string | null;
}>;

export function findingKeys(key: string): {
  titleKey: string;
  detailKey: string;
} {
  return {
    titleKey: `googleBusiness.findings.${key}.title`,
    detailKey: `googleBusiness.findings.${key}.detail`,
  };
}

export function checklistResult(
  area: AnalysisArea,
  items: readonly ChecklistItem[],
  extraMetrics: Readonly<Record<string, number | null>> = {},
): AnalysisResult {
  const judged = items.filter((item) => item.ok !== null);
  const findings: AnalysisFinding[] = judged
    .filter((item) => item.ok === false)
    .map((item) => ({
      key: item.key,
      area,
      severity: item.severity,
      ...findingKeys(item.key),
      ...(item.values ? { values: item.values } : {}),
      ...(item.current !== undefined ? { current: item.current } : {}),
      source: "deterministic" as const,
    }));
  return {
    status: "done",
    findings,
    metrics: {
      itemsOk: judged.filter((item) => item.ok).length,
      itemsTotal: judged.length,
      ...extraMetrics,
    },
  };
}
