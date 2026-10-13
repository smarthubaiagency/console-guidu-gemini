import { describe, expect, it } from "vitest";

import {
  applyConfigEdit,
  editableFields,
  editableTabs,
  missingConfigFields,
  sameValue,
} from "./editing";
import { AgentConfigV1 } from "./schema";

describe("division of the configuration fields (especificação §5.2)", () => {
  it("gives the template owner every field but the key and the versions", () => {
    const fields = editableFields("template");
    expect(fields.has("integration.tools")).toBe(true);
    expect(fields.has("overview.expected_output")).toBe(true);
    expect(fields.has("model.model_provider")).toBe(true);
    expect(fields.has("model.credential_id")).toBe(false);
    expect(fields.has("overview.prompt_version")).toBe(false);
    expect(fields.has("rules.scoring_rules_version")).toBe(false);
    expect(editableTabs("template")).toHaveLength(5);
  });

  it("gives the partner the key, never the provider (it comes from the key)", () => {
    const fields = editableFields("partner");
    expect(fields.has("model.credential_id")).toBe(true);
    expect(fields.has("model.model_provider")).toBe(false);
    expect(fields.has("integration.crm_webhook_url")).toBe(true);
  });

  it("gives the partner's Assistant its overview and model connection only", () => {
    expect(editableTabs("assistant")).toEqual(["overview", "model"]);
    const fields = editableFields("assistant");
    expect(fields.has("overview.system_prompt")).toBe(true);
    expect(fields.has("model.credential_id")).toBe(true);
    expect(fields.has("model.audio_enabled")).toBe(false);
    expect(fields.has("integration.tools")).toBe(false);
    expect(fields.has("model.model_provider")).toBe(false);
  });

  it("limits the customer to the model connection", () => {
    expect(editableTabs("customer")).toEqual(["model"]);
    const fields = editableFields("customer");
    expect(fields.has("model.model_name")).toBe(true);
    expect(fields.has("overview.agent_name")).toBe(false);
  });

  it("never gives the customizing customer tools, expected output or integration", () => {
    const fields = editableFields("customer_custom");
    expect(fields.has("overview.agent_name")).toBe(true);
    expect(fields.has("rules.lead_scoring_rules")).toBe(true);
    expect(fields.has("overview.expected_output")).toBe(false);
    expect(fields.has("integration.tools")).toBe(false);
    expect(fields.has("integration.lead_destination")).toBe(false);
    expect(editableTabs("customer_custom")).not.toContain("integration");
  });
});

describe("applyConfigEdit", () => {
  const current = {
    overview: {
      agent_name: "Anna",
      expected_output: "Lead qualificado",
      system_prompt: "Você é {{agent_name}}.",
      prompt_version: 3,
    },
    rules: { handoff_mode: "never" },
    integration: { tools: ["think", "handoff"] },
    model: { model_name: "gpt-4o-mini" },
  };

  it("takes the editable fields and keeps the others", () => {
    const edit = applyConfigEdit(
      current,
      {
        overview: { agent_name: "Bia" },
        model: { model_name: "gpt-4.1" },
      },
      "customer",
    );
    // The customer changes only the model; the rest stays as it was.
    expect(edit.config.overview).toEqual(current.overview);
    expect(edit.config.model).toEqual({ model_name: "gpt-4.1" });
    expect(edit.changed).toEqual(["model.model_name"]);
    expect(edit.forbidden).toEqual(["overview.agent_name"]);
  });

  it("does not count unchanged fields outside the division as forbidden", () => {
    const edit = applyConfigEdit(
      current,
      { ...current, overview: { ...current.overview, agent_name: "Bia" } },
      "customer_custom",
    );
    expect(edit.forbidden).toEqual([]);
    expect(edit.changed).toEqual(["overview.agent_name"]);
    expect(edit.config.integration).toEqual(current.integration);
  });

  it("clears an editable field left out of the submission", () => {
    const edit = applyConfigEdit(current, { overview: {} }, "template");
    expect(edit.config.overview.agent_name).toBeUndefined();
    expect(edit.changed).toContain("overview.agent_name");
  });

  it("raises the prompt and rules versions with their content", () => {
    const edit = applyConfigEdit(
      current,
      {
        ...current,
        overview: { ...current.overview, system_prompt: "Novo." },
        rules: {
          handoff_mode: "never",
          lead_scoring_rules: [
            {
              rule_id: "a",
              key_group: "g",
              label: "A",
              signal: "s",
              points: 1,
            },
          ],
        },
      },
      "partner",
    );
    expect(edit.config.overview.prompt_version).toBe(4);
    expect(edit.config.rules.scoring_rules_version).toBe(2);
    // A version sent by the client is ignored, never forbidden.
    const versioned = applyConfigEdit(
      current,
      { ...current, overview: { ...current.overview, prompt_version: 99 } },
      "partner",
    );
    expect(versioned.forbidden).toEqual([]);
    expect(versioned.config.overview.prompt_version).toBe(3);
  });

  it("never reports the provider as forbidden: it follows the key", () => {
    const edit = applyConfigEdit(
      current,
      { ...current, model: { ...current.model, model_provider: "openai" } },
      "assistant",
    );
    expect(edit.forbidden).toEqual([]);
  });

  it("compares JSON values whatever the order of the keys", () => {
    expect(
      sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
    ).toBe(true);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });
});

describe("missingConfigFields (campos.md §9)", () => {
  it("lists the minimum fields still empty", () => {
    const empty = AgentConfigV1.parse({});
    expect(missingConfigFields(empty, "partner")).toEqual([
      "overview.agent_name",
      "overview.language",
      "overview.agent_tone",
      "overview.system_prompt",
      "overview.business_summary",
      "overview.products_services",
      "scope.timezone",
      "scope.availability_slots",
      "rules.handoff_mode",
      "rules.after_hours_behavior",
      "rules.out_of_scope_action",
      "model.credential_id",
      "model.model_name",
    ]);
    // The Assistant answers in the panel: no hours nor lead rules.
    expect(missingConfigFields(empty, "assistant")).toEqual([
      "overview.agent_name",
      "overview.language",
      "overview.agent_tone",
      "overview.system_prompt",
      "model.credential_id",
      "model.model_name",
    ]);
    // A template has no key.
    expect(missingConfigFields(empty, "template")).not.toContain(
      "model.credential_id",
    );
  });
});
