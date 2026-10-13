import { describe, expect, it } from "vitest";

import { assignRuleIds, ruleIdFromLabel, scoreLead } from "./scoring";

const rule = (label: string, rule_id?: string) => ({
  ...(rule_id ? { rule_id } : {}),
  key_group: "intencao",
  label,
  signal: label,
  points: 10,
});

describe("lead scoring rule ids", () => {
  it("derives the id from the label", () => {
    expect(ruleIdFromLabel("Pede proposta!")).toBe("pede_proposta");
    expect(ruleIdFromLabel("  Orçamento e prazo  ")).toBe("orcamento_e_prazo");
    expect(ruleIdFromLabel("!!!")).toBe("regra");
    expect(ruleIdFromLabel("a".repeat(80))).toHaveLength(60);
  });

  it("keeps the id when the label is edited (critério 8)", () => {
    const saved = assignRuleIds([], [rule("Pede proposta")]);
    expect(saved[0]?.rule_id).toBe("pede_proposta");
    const edited = assignRuleIds(saved, [
      rule("Pede orçamento formal", saved[0]!.rule_id),
    ]);
    expect(edited[0]).toMatchObject({
      rule_id: "pede_proposta",
      label: "Pede orçamento formal",
    });
  });

  it("gives new rules unique ids, never one already used", () => {
    const saved = assignRuleIds([], [rule("Prazo")]);
    const next = assignRuleIds(saved, [
      rule("Prazo", "prazo"),
      rule("Prazo"),
      rule("Prazo"),
    ]);
    expect(next.map((r) => r.rule_id)).toEqual(["prazo", "prazo_2", "prazo_3"]);
    // A removed rule's id is not reused by a new rule with the same label.
    const afterRemoval = assignRuleIds(next, [rule("Prazo")]);
    expect(afterRemoval[0]?.rule_id).toBe("prazo_4");
  });

  it("never takes an id chosen by the browser", () => {
    const next = assignRuleIds([], [rule("Pede proposta", "id_inventado")]);
    expect(next[0]?.rule_id).toBe("pede_proposta");
    // The same saved id sent twice is kept only once.
    const saved = assignRuleIds([], [rule("Prazo")]);
    const twice = assignRuleIds(saved, [
      rule("Prazo", "prazo"),
      rule("Outro", "prazo"),
    ]);
    expect(twice.map((r) => r.rule_id)).toEqual(["prazo", "outro"]);
  });
});

describe("scoreLead", () => {
  const rules = [
    {
      rule_id: "pede_proposta",
      key_group: "intencao",
      label: "Pede proposta",
      signal: "pede",
      points: 30,
    },
    {
      rule_id: "tem_prazo",
      key_group: "intencao",
      label: "Tem prazo",
      signal: "prazo",
      points: 20,
    },
    {
      rule_id: "concorrente",
      key_group: "risco",
      label: "É concorrente",
      signal: "conc",
      points: -50,
    },
  ];

  it("sums each matched rule once and reports unknown ids", () => {
    const score = scoreLead(
      rules,
      ["pede_proposta", "tem_prazo", "pede_proposta", "x"],
      { hot: 50, warm: 20 },
    );
    expect(score.points).toBe(50);
    expect(score.temperature).toBe("hot");
    expect(score.breakdown.map((b) => b.rule_id)).toEqual([
      "pede_proposta",
      "tem_prazo",
    ]);
    expect(score.unknown).toEqual(["x"]);
  });

  it("derives the temperature from the thresholds", () => {
    expect(
      scoreLead(rules, ["pede_proposta"], { hot: 50, warm: 20 }).temperature,
    ).toBe("warm");
    expect(scoreLead(rules, [], { hot: 50, warm: 20 }).temperature).toBe(
      "cold",
    );
    expect(
      scoreLead(rules, ["concorrente"], { hot: 50, warm: 20 }).temperature,
    ).toBe("suspect");
    expect(scoreLead(rules, ["pede_proposta"], {}).temperature).toBe("cold");
  });
});
