import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAgentConfig } from "../config/schema";
import { noticeScore, noticeText, shouldNotice, signNotice } from "./lead";

const config = (rules: Record<string, unknown>, language = "pt-BR") => {
  const parsed = parseAgentConfig("guid", 1, {
    overview: { agent_name: "Anna", language },
    rules,
  });
  if (!parsed.success) throw new Error("invalid config");
  return parsed.data;
};

const rule = (rule_id: string, notify_immediately = false) => ({
  rule_id,
  key_group: "intencao",
  label: rule_id,
  signal: rule_id,
  points: 10,
  notify_immediately,
});

const facts = {
  agentName: "Anna",
  contact: { name: "Maria", phone: "+5511999990000", email: null },
  points: 70,
  temperature: "hot" as const,
  reasons: ["Pede proposta", "Tem orçamento"],
};

describe("hot-lead notice (A6a)", () => {
  it("uses the notice score, else the hot threshold", () => {
    expect(noticeScore(config({ notify_on_score: 40 }).rules)).toBe(40);
    expect(noticeScore(config({ hot_score_threshold: 60 }).rules)).toBe(60);
    expect(noticeScore(config({}).rules)).toBeNull();
  });

  it("tells at the score, or at once for a rule marked so", () => {
    const rules = config({
      notify_on_score: 50,
      lead_scoring_rules: [rule("pede_proposta"), rule("urgente", true)],
    }).rules;
    expect(
      shouldNotice(rules, { points: 50, ruleIds: ["pede_proposta"] }),
    ).toBe(true);
    expect(
      shouldNotice(rules, { points: 49, ruleIds: ["pede_proposta"] }),
    ).toBe(false);
    expect(shouldNotice(rules, { points: 10, ruleIds: ["urgente"] })).toBe(
      true,
    );
    expect(
      shouldNotice(config({}).rules, { points: 1000, ruleIds: ["x"] }),
    ).toBe(false);
  });

  it("writes the default text in the agent's language", () => {
    expect(noticeText(config({}), facts)).toBe(
      "Lead quente no Anna: Maria (+5511999990000), score 70 (quente). Motivos: Pede proposta, Tem orçamento.",
    );
    expect(noticeText(config({}, "en-US"), facts)).toContain(
      "Hot lead on Anna",
    );
  });

  it("fills the agent's template and keeps unknown tags", () => {
    const text = noticeText(
      config({
        notify_template:
          "{{contact.name}} ({{contact.email}}) chegou a {{lead.score}}, {{lead.temperature}}. {{outro.tag}}",
      }),
      facts,
    );
    expect(text).toBe("Maria (-) chegou a 70, quente. {{outro.tag}}");
  });

  it("signs timestamp and body with the partner's secret", () => {
    const expected = createHmac("sha256", "segredo-do-parceiro")
      .update('1700000000.{"a":1}')
      .digest("hex");
    expect(signNotice("segredo-do-parceiro", "1700000000", '{"a":1}')).toBe(
      `sha256=${expected}`,
    );
  });
});
