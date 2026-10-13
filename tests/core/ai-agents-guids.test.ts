import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAgentConfig } from "@/core/ai/config/schema";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { aiAgentsDataContract } from "@/modules/ai-agents/data";
import {
  createGuid,
  listGuids,
  listGuidTemplates,
} from "@/modules/ai-agents/server";
import { AppError } from "@/shared/errors";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A1: GUIDS of the workspace — created from a published template or blank,
 * copying the whole configuration, within the plan limit (D-AG-16).
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const ANNA = "a1a00000-0000-4000-8000-000000000002";
const ONBOARDING = "a1a00000-0000-4000-8000-000000000003";
const ADMIN_TEMPLATE = "a1a00000-0000-4000-8000-000000000001";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const viewerCtx = { ...contextA, userId: ids.userMultiOrg };

describeDatabase("A1: GUIDS of the workspace", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const run = <T>(
    ctx: RequestContext,
    op: (tx: ContextTransaction) => Promise<T>,
  ) => withContext(prisma, ctx, op);

  async function limit(value: number | null) {
    await admin.$executeRawUnsafe(
      `delete from public.platform_modules where module_key = 'ai-agents'`,
    );
    if (value === null) return;
    await admin.$executeRawUnsafe(
      `insert into public.platform_modules (module_key, availability, config, updated_by)
       values ('ai-agents', 'enabled', '{"quotaDefaults": {"ai-agents.max": ${value}}}', '${PLATFORM_OWNER}')`,
    );
  }

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where kind = 'guid' and workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
  }

  beforeAll(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    await cleanup();
    for (const ctx of [contextA, contextB]) {
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
         values ('${ctx.organizationId}', '${ctx.workspaceId}', 'ai-agents', 'enabled', '${ctx.userId}')
         on conflict (workspace_id, module_key) do update set status = 'enabled'`,
      );
    }
  });

  afterEach(async () => {
    await cleanup();
    await limit(null);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where module_key = 'ai-agents'
       and workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("offers the published house templates, never the admin one", async () => {
    const templates = await run(contextA, (tx) =>
      listGuidTemplates(tx, contextA),
    );
    expect(templates.map((t) => t.id).sort()).toEqual(
      [ANNA, ONBOARDING].sort(),
    );
    expect(templates.map((t) => t.id)).not.toContain(ADMIN_TEMPLATE);
  });

  it("creates a GUIDS copying the whole configuration of the template", async () => {
    const guid = await run(contextA, (tx) =>
      createGuid(tx, contextA, { templateId: ANNA }),
    );
    expect(guid).toMatchObject({
      name: "Anna",
      status: "draft",
      templateId: ANNA,
      templateVersion: 1,
      customized: false,
      keyState: "ok",
      updatedByPartnerId: null,
    });

    const [row, template] = await Promise.all([
      admin.aiAgent.findUniqueOrThrow({ where: { id: guid.id } }),
      admin.aiAgentTemplate.findUniqueOrThrow({ where: { id: ANNA } }),
    ]);
    const defaults = parseAgentConfig("guid", 1, template.defaults);
    if (!defaults.success) throw defaults.error;
    // The prompt of the template comes with the copy (A3a).
    expect(template.promptTemplate).not.toBe("");
    expect(row.config).toEqual({
      ...defaults.data,
      overview: {
        ...defaults.data.overview,
        system_prompt: template.promptTemplate,
      },
    });
    expect(row).toMatchObject({
      kind: "guid",
      workspaceId: ids.workspaceA,
      organizationId: ids.organizationA,
      createdBy: ids.userA,
    });
    const rules = (row.config as { rules: { lead_scoring_rules: unknown[] } })
      .rules.lead_scoring_rules;
    expect(rules.length).toBeGreaterThan(0);

    const audit = await admin.auditEvent.findFirst({
      where: { action: "ai_agents.guid.create", resourceId: guid.id },
    });
    expect(audit?.result).toBe("success");

    // The other workspace sees nothing of it.
    expect(await run(contextB, (tx) => listGuids(tx, contextB))).toEqual([]);

    // The workspace export carries the GUIDS without any secret.
    const exported = (await run(contextA, (tx) =>
      aiAgentsDataContract.export(tx, contextA),
    )) as { guids: { id: string }[] };
    expect(exported.guids.map((g) => g.id)).toEqual([guid.id]);
  });

  it("creates a blank GUIDS for the custom option", async () => {
    const guid = await run(contextA, (tx) =>
      createGuid(tx, contextA, { templateId: null }),
    );
    expect(guid).toMatchObject({
      name: null,
      templateId: null,
      templateVersion: null,
      customized: true,
    });
  });

  it("refuses a GUIDS over the plan limit, even under concurrency", async () => {
    // Default limit of the manifest: 1.
    await run(contextA, (tx) => createGuid(tx, contextA, { templateId: ANNA }));
    await expect(
      run(contextA, (tx) =>
        createGuid(tx, contextA, { templateId: ONBOARDING }),
      ),
    ).rejects.toThrow(/Limite do plano atingido/);

    // A limit of 3: two parallel creations fill it, a third is refused.
    await limit(3);
    const results = await Promise.allSettled([
      run(contextA, (tx) => createGuid(tx, contextA, { templateId: ANNA })),
      run(contextA, (tx) => createGuid(tx, contextA, { templateId: null })),
      run(contextA, (tx) =>
        createGuid(tx, contextA, { templateId: ONBOARDING }),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await run(contextA, (tx) => listGuids(tx, contextA))).toHaveLength(
      3,
    );
  });

  it("refuses unknown templates, the admin template and members without permission", async () => {
    for (const templateId of [ADMIN_TEMPLATE, crypto.randomUUID()]) {
      await expect(
        run(contextA, (tx) => createGuid(tx, contextA, { templateId })),
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof AppError && e.code === "not_found",
      );
    }
    await expect(
      run(viewerCtx, (tx) => createGuid(tx, viewerCtx, { templateId: ANNA })),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(
      await admin.aiAgent.count({
        where: { workspaceId: ids.workspaceA, kind: "guid" },
      }),
    ).toBe(0);
  });
});
