import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRENT_CONFIG_VERSION, parseAgentConfig } from "./schema";

const parse = (raw: unknown, kind: "guid" | "assistant" = "guid") =>
  parseAgentConfig(kind, CURRENT_CONFIG_VERSION, raw);

const messages = (raw: unknown, kind: "guid" | "assistant" = "guid") => {
  const result = parse(raw, kind);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("agent configuration v1", () => {
  it("accepts an empty draft and fills the tabs", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      overview: {},
      scope: {},
      rules: {},
      integration: {},
      model: {},
    });
  });

  it("refuses unknown fields and tabs", () => {
    expect(parse({ overview: { agent_nome: "Anna" } }).success).toBe(false);
    expect(parse({ widget: {} }).success).toBe(false);
  });

  it("keeps one set of values per enum (campos.md §7)", () => {
    expect(parse({ rules: { handoff_mode: "high_intent" } }).success).toBe(
      true,
    );
    // Legacy screen codes the prompt did not understand.
    expect(parse({ rules: { handoff_mode: "manual" } }).success).toBe(false);
    expect(
      parse({ rules: { after_hours_behavior: "collect_and_notify" } }).success,
    ).toBe(false);
    expect(parse({ rules: { out_of_scope_action: "ignore" } }).success).toBe(
      false,
    );
  });

  it("validates scoring rules, thresholds, slots and the time zone", () => {
    const rule = {
      rule_id: "pede_proposta",
      key_group: "intencao",
      label: "Pede proposta",
      signal: "Pede proposta",
      points: 30,
    };
    expect(parse({ rules: { lead_scoring_rules: [rule] } }).success).toBe(true);
    expect(
      parse({ rules: { lead_scoring_rules: [{ ...rule, points: 101 }] } })
        .success,
    ).toBe(false);
    expect(messages({ rules: { lead_scoring_rules: [rule, rule] } })).toContain(
      "Regras de pontuação com o mesmo identificador.",
    );
    expect(
      messages({
        rules: { hot_score_threshold: 30, warm_score_threshold: 60 },
      }),
    ).toContain("O limiar de lead quente deve ser maior que o de morno.");
    expect(
      messages({
        scope: {
          availability_slots: [
            { weekday: "mon", start: "18:00", end: "09:00" },
          ],
        },
      }),
    ).toContain("O horário final deve ser depois do inicial.");
    expect(parse({ scope: { timezone: "America/Sao_Paulo" } }).success).toBe(
      true,
    );
    expect(parse({ scope: { timezone: "Brasil/Centro" } }).success).toBe(false);
  });

  it("requires an https webhook when leads go to a webhook", () => {
    expect(
      messages({ integration: { lead_destination: "webhook" } }),
    ).toContain("Informe o endereço do webhook.");
    expect(
      parse({
        integration: {
          lead_destination: "both",
          crm_webhook_url: "http://crm.example.com/hook",
        },
      }).success,
    ).toBe(false);
    expect(
      parse({
        integration: {
          lead_destination: "both",
          crm_webhook_url: "https://crm.example.com/hook",
        },
      }).success,
    ).toBe(true);
  });

  it("allows only the tools of the agent kind", () => {
    expect(parse({ integration: { tools: ["score_lead"] } }).success).toBe(
      true,
    );
    expect(
      messages({ integration: { tools: ["propose_operation"] } }),
    ).toContain(
      "A ferramenta propose_operation não está disponível para este agente.",
    );
    expect(
      parse({ integration: { tools: ["propose_operation"] } }, "assistant")
        .success,
    ).toBe(true);
    expect(
      parse({ integration: { tools: ["score_lead"] } }, "assistant").success,
    ).toBe(false);
    expect(parse({ integration: { tools: ["http_request"] } }).success).toBe(
      false,
    );
    expect(parse({ integration: { tools: ["think", "think"] } }).success).toBe(
      false,
    );
  });

  it("refuses a version it does not know", () => {
    const result = parseAgentConfig("guid", 2, {});
    expect(result.success).toBe(false);
  });

  it("validates the templates seeded by the A1 migration", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261029090000_a1_ai_agents.sql",
      ),
      "utf8",
    );
    const documents = [...sql.matchAll(/\$json\$([\s\S]*?)\$json\$/g)].map(
      (m) => JSON.parse(m[1]!) as { integration: { tools: string[] } },
    );
    expect(documents).toHaveLength(3);
    // The admin template comes first; the other two are GUIDS templates.
    const kinds = ["assistant", "guid", "guid"] as const;
    documents.forEach((doc, index) => {
      const result = parse(doc, kinds[index]);
      expect(result.success ? [] : result.error.issues).toEqual([]);
    });
  });
});
