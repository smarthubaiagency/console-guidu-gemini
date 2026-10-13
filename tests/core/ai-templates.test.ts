import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConfigValidationError,
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  type TemplateActor,
  updateTemplate,
} from "@/core/ai/templates";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A3a: the house's agent templates in `/platform`. The owner edits every
 * field but the key; the version goes up with the content; the admin
 * template is never deleted nor unpublished; RLS repeats the role.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const PLATFORM_BILLING = "d0000000-0000-4000-8000-000000000010";
const ADMIN_TEMPLATE = "a1a00000-0000-4000-8000-000000000001";
const SDR_TEMPLATE = "a1a00000-0000-4000-8000-000000000002";

describeDatabase("A3a: house agent templates", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const owner: TemplateActor = {
    userId: PLATFORM_OWNER,
    partnerId: null,
    platformRole: "owner",
  };
  const asPlatform = <T>(
    userId: string,
    op: (tx: ContextTransaction) => Promise<T>,
  ) => withIdentityContext(prisma, userId, op);

  // The seeds this test saves, restored at the end.
  const seeds = new Map<
    string,
    { defaults: object; promptTemplate: string; version: number }
  >();

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.ai_agent_templates where name like 'Teste A3a%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.platform_admin_members where user_id = '${PLATFORM_BILLING}'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.platform_admin_members (user_id, role, status) values ('${PLATFORM_BILLING}', 'billing', 'active')`,
    );
    for (const id of [ADMIN_TEMPLATE, SDR_TEMPLATE]) {
      const row = await admin.aiAgentTemplate.findUniqueOrThrow({
        where: { id },
      });
      seeds.set(id, {
        defaults: row.defaults as object,
        promptTemplate: row.promptTemplate,
        version: row.version,
      });
    }
  });

  afterAll(async () => {
    await cleanup();
    for (const [id, data] of seeds) {
      await admin.aiAgentTemplate.update({ where: { id }, data });
    }
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("lists the house templates with the prompt in the configuration", async () => {
    const list = await asPlatform(PLATFORM_OWNER, (tx) =>
      listTemplates(tx, owner),
    );
    expect(list.map((t) => t.id)).toEqual(
      expect.arrayContaining([ADMIN_TEMPLATE, SDR_TEMPLATE]),
    );
    expect(list[0]?.kind).toBe("admin");

    const sdr = await asPlatform(PLATFORM_OWNER, (tx) =>
      getTemplate(tx, owner, SDR_TEMPLATE),
    );
    expect(sdr.configValid).toBe(true);
    // The A1 seeds keep the prompt in `prompt_template` only.
    expect(sdr.config.overview.system_prompt).toContain("{{agent_name}}");
  });

  it("creates, edits, publishes and deletes a GUIDS template", async () => {
    const created = await asPlatform(PLATFORM_OWNER, (tx) =>
      createTemplate(tx, owner, { name: "Teste A3a agendador" }),
    );
    expect(created).toMatchObject({
      kind: "guid",
      version: 1,
      published: false,
    });

    const saved = await asPlatform(PLATFORM_OWNER, (tx) =>
      updateTemplate(tx, owner, created.id, {
        name: "Teste A3a agendador",
        description: "Marca horários.",
        segment: "Serviços",
        published: true,
        config: {
          overview: {
            agent_name: "Bia",
            language: "pt-BR",
            system_prompt: "Você é {{agent_name}}.",
          },
          rules: {
            handoff_mode: "always_ask",
            lead_scoring_rules: [
              {
                rule_id: "quer_agendar",
                key_group: "intencao",
                label: "Quer agendar",
                signal: "Pede um horário",
                points: 30,
              },
            ],
          },
          integration: { tools: ["think", "handoff"] },
          model: { model_provider: "openai", model_name: "gpt-4o-mini" },
        },
      }),
    );
    expect(saved).toMatchObject({ version: 2, published: true });
    expect(saved.config.overview.prompt_version).toBe(2);
    expect(saved.config.rules.scoring_rules_version).toBe(2);

    const row = await admin.aiAgentTemplate.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.promptTemplate).toBe("Você é {{agent_name}}.");
    expect(row.approvedBy).toBe(PLATFORM_OWNER);
    expect(row.updatedBy).toBe(PLATFORM_OWNER);

    // Only the name: the version stays.
    const renamed = await asPlatform(PLATFORM_OWNER, (tx) =>
      updateTemplate(tx, owner, created.id, {
        name: "Teste A3a agenda",
        description: "Marca horários.",
        segment: "Serviços",
        published: true,
        config: saved.config,
      }),
    );
    expect(renamed.version).toBe(2);

    const audits = await admin.auditEvent.findMany({
      where: { resourceId: created.id, action: "ai.template.update" },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.metadata).toMatchObject({
      from: { version: 1, published: false },
      to: { version: 2, published: true },
    });
    expect((audits[0]?.metadata as { fields: string[] }).fields).toEqual(
      expect.arrayContaining(["published", "overview.agent_name"]),
    );

    await asPlatform(PLATFORM_OWNER, (tx) =>
      deleteTemplate(tx, owner, created.id),
    );
    expect(
      await admin.aiAgentTemplate.count({ where: { id: created.id } }),
    ).toBe(0);
  });

  it("refuses an invalid configuration with the message of each field", async () => {
    const created = await asPlatform(PLATFORM_OWNER, (tx) =>
      createTemplate(tx, owner, { name: "Teste A3a inválido" }),
    );
    const attempt = (config: unknown) =>
      asPlatform(PLATFORM_OWNER, (tx) =>
        updateTemplate(tx, owner, created.id, {
          name: "Teste A3a inválido",
          description: "",
          segment: "",
          published: false,
          config,
        }),
      );

    const invalid = await attempt({
      rules: { hot_score_threshold: 10, warm_score_threshold: 20 },
      integration: { tools: ["workspace_read"] },
    }).catch((err: unknown) => err);
    expect(invalid).toBeInstanceOf(ConfigValidationError);
    const errors = (invalid as ConfigValidationError).fieldErrors;
    expect(errors["rules.hot_score_threshold"]).toBeDefined();
    // A tool of the Assistant is not a GUIDS tool.
    expect(errors["integration.tools.0"]).toBeDefined();

    // The key is the agent's, never the template's.
    const keyed = await attempt({
      model: { credential_id: "00000000-0000-4000-8000-000000000001" },
    }).catch((err: unknown) => err);
    expect(keyed).toBeInstanceOf(ConfigValidationError);
    expect(
      (keyed as ConfigValidationError).fieldErrors["model.credential_id"],
    ).toBeDefined();
  });

  it("keeps the Assistant's template published and undeletable", async () => {
    const before = await asPlatform(PLATFORM_OWNER, (tx) =>
      getTemplate(tx, owner, ADMIN_TEMPLATE),
    );
    const saved = await asPlatform(PLATFORM_OWNER, (tx) =>
      updateTemplate(tx, owner, ADMIN_TEMPLATE, {
        name: before.name,
        description: before.description ?? "",
        segment: before.segment ?? "",
        published: false,
        config: before.config,
      }),
    );
    expect(saved.published).toBe(true);
    expect(saved.version).toBe(before.version);

    const error = await asPlatform(PLATFORM_OWNER, (tx) =>
      deleteTemplate(tx, owner, ADMIN_TEMPLATE),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("conflict");
  });

  it("refuses roles without platform.ai.manage, here and in the database", async () => {
    const billing: TemplateActor = {
      userId: PLATFORM_BILLING,
      partnerId: null,
      platformRole: "billing",
    };
    await expect(
      asPlatform(PLATFORM_BILLING, (tx) => listTemplates(tx, billing)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // RLS: billing reads but does not write templates.
    const updated = await asPlatform(PLATFORM_BILLING, (tx) =>
      tx.aiAgentTemplate.updateMany({
        where: { id: SDR_TEMPLATE },
        data: { name: "Teste A3a invadido", updatedBy: PLATFORM_BILLING },
      }),
    );
    expect(updated.count).toBe(0);
  });
});
