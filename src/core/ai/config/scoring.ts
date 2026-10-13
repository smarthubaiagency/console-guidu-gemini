/**
 * Stable ids of the lead scoring rules (campos.md §3, critério 8): the
 * `rule_id` comes from the label only when the rule is created and never
 * changes after, so the scoring log keeps pointing at the same rule when
 * the label is edited.
 */

export type ScoringRuleFields = {
  key_group: string;
  label: string;
  signal: string;
  points: number;
  capture_field?: string | undefined;
  notify_immediately?: boolean | undefined;
};

export type ScoringRule = ScoringRuleFields & { rule_id: string };

/** A rule from the editor: new rules have no id yet. */
export type ScoringRuleInput = ScoringRuleFields & { rule_id?: string | null };

const MAX_ID = 60;

/** "Pede proposta!" -> "pede_proposta"; accents dropped, never empty. */
export function ruleIdFromLabel(label: string): string {
  const id = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_ID)
    .replace(/_+$/g, "");
  return id || "regra";
}

/**
 * Ids of the rules being saved. A rule keeps its id when it carries one of
 * the rules already saved; any other rule is new and gets an id from its
 * label, made unique with a suffix. The browser never chooses an id.
 */
export function assignRuleIds(
  saved: readonly Pick<ScoringRule, "rule_id">[],
  next: readonly ScoringRuleInput[],
): ScoringRule[] {
  const known = new Set(saved.map((rule) => rule.rule_id));
  const taken = new Set<string>();
  // Kept ids first, so a new rule never takes the id of an existing one.
  const kept = next.map((rule) => {
    const id = rule.rule_id;
    if (id && known.has(id) && !taken.has(id)) {
      taken.add(id);
      return id;
    }
    return null;
  });
  for (const id of known) taken.add(id);
  return next.map((rule, index) => {
    let id = kept[index];
    if (!id) {
      const base = ruleIdFromLabel(rule.label);
      id = base;
      for (let n = 2; taken.has(id); n++) {
        const suffix = `_${n}`;
        id = `${base.slice(0, MAX_ID - suffix.length)}${suffix}`;
      }
      taken.add(id);
    }
    return { ...rule, rule_id: id };
  });
}

export type LeadTemperature = "hot" | "warm" | "cold" | "suspect";

export type LeadScore = Readonly<{
  points: number;
  temperature: LeadTemperature;
  breakdown: readonly Readonly<{
    rule_id: string;
    label: string;
    points: number;
  }>[];
  /** Ids the model sent that the agent does not have. */
  unknown: readonly string[];
}>;

/**
 * Score of the signals the agent saw in a turn (`score_lead`, A2b): the sum
 * of the matched rules, each counted once, and the temperature from the
 * thresholds. Without thresholds a positive score is `cold`; a negative
 * score is always `suspect`.
 */
export function scoreLead(
  rules: readonly ScoringRule[],
  ruleIds: readonly string[],
  thresholds: Readonly<{ hot?: number | undefined; warm?: number | undefined }>,
): LeadScore {
  const byId = new Map(rules.map((rule) => [rule.rule_id, rule]));
  const seen = new Set<string>();
  const breakdown: { rule_id: string; label: string; points: number }[] = [];
  const unknown: string[] = [];
  for (const id of ruleIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const rule = byId.get(id);
    if (!rule) {
      unknown.push(id);
      continue;
    }
    breakdown.push({
      rule_id: rule.rule_id,
      label: rule.label,
      points: rule.points,
    });
  }
  const points = breakdown.reduce((sum, item) => sum + item.points, 0);
  const temperature: LeadTemperature =
    points < 0
      ? "suspect"
      : thresholds.hot !== undefined && points >= thresholds.hot
        ? "hot"
        : thresholds.warm !== undefined && points >= thresholds.warm
          ? "warm"
          : "cold";
  return { points, temperature, breakdown, unknown };
}
