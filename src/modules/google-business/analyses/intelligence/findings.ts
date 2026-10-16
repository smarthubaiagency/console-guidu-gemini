import type {
  AnalysisArea,
  AnalysisFinding,
  FindingSeverity,
} from "../contract";

/**
 * Findings of the intelligence analyses always point to messages of the
 * `gbIntelligence` namespace, in the three languages
 * (`findings.<id>.title` and `.detail`); the step labels of the
 * onboarding window are `steps.<id>`. Ids are the camelCase of the key.
 */

export const INTELLIGENCE_NAMESPACE = "gbIntelligence";

export function camelId(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

export function stepLabel(analysisKey: string): string {
  return `${INTELLIGENCE_NAMESPACE}.steps.${camelId(analysisKey)}`;
}

export function findingMessageKeys(messageId: string): {
  titleKey: string;
  detailKey: string;
} {
  const id = camelId(messageId);
  return {
    titleKey: `${INTELLIGENCE_NAMESPACE}.findings.${id}.title`,
    detailKey: `${INTELLIGENCE_NAMESPACE}.findings.${id}.detail`,
  };
}

export function finding(
  input: Readonly<{
    /** Stable key of the finding within the analysis. */
    key: string;
    /** Message id when it differs from the key (several findings, one text). */
    titleKey?: string;
    area: AnalysisArea;
    severity: FindingSeverity;
    source: AnalysisFinding["source"];
    values?: Readonly<Record<string, string | number | null | undefined>>;
    current?: string | null;
    suggested?: string | null;
  }>,
): AnalysisFinding {
  const values = Object.fromEntries(
    Object.entries(input.values ?? {}).filter(
      (entry): entry is [string, string | number] =>
        entry[1] !== null && entry[1] !== undefined,
    ),
  );
  return {
    key: input.key,
    area: input.area,
    severity: input.severity,
    ...findingMessageKeys(input.titleKey ?? input.key),
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(input.current !== undefined ? { current: input.current } : {}),
    ...(input.suggested !== undefined ? { suggested: input.suggested } : {}),
    source: input.source,
  };
}
