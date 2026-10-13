import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConfigValidationError } from "@/core/ai/templates";
import { registerCredential } from "@/core/credentials/vault";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import {
  createGuid,
  createReferral,
  customizeGuid,
  deleteGuid,
  deleteReferral,
  getGuid,
  updateGuid,
  updateReferral,
} from "@/modules/ai-agents/server";
import { AppError } from "@/shared/errors";

import { contextA, contextB, contextMultiOrgInA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A4a: a GUIDS in the workspace's own screens — the model connection with
 * a key of the workspace's vault, turning it on, customizing it (and only
 * then the overview and the referrals), deleting it. Another workspace and
 * a viewer see nothing.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const ANNA = "a1a00000-0000-4000-8000-000000000002";
const SECRET = "sk-or-v1-0123456789abcdef0123456789";
const LABEL = "Chave A4a";

describeDatabase("A4a: GUIDS of the workspace in /app", requiredVars, () => {
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

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where kind = 'guid' and workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_agent_referrals where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where label = '${LABEL}'`,
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

  afterEach(cleanup);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where module_key = 'ai-agents'
       and workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  async function newGuid() {
    const guid = await run(contextA, (tx) =>
      createGuid(tx, contextA, { templateId: ANNA }),
    );
    const key = await run(contextA, (tx) =>
      registerCredential(tx, contextA, {
        provider: "openrouter",
        label: LABEL,
        secret: SECRET,
      }),
    );
    // The business is the partner's to describe while the GUIDS follows its
    // template (§5.2): written here as the partner would in `/admin`.
    await admin.$executeRawUnsafe(
      `update public.ai_agents set config = jsonb_set(config, '{overview}',
         config->'overview' || '{"business_summary": "Clínica odontológica.", "products_services": "Limpeza e clareamento."}')
       where id = '${guid.id}'`,
    );
    return { guid, key };
  }

  it("sets the key of the vault and the model, then turns the GUIDS on", async () => {
    const { guid, key } = await newGuid();
    const before = await run(contextA, (tx) => getGuid(tx, contextA, guid.id));
    expect(before).toMatchObject({
      editor: "customer",
      customized: false,
      status: "draft",
    });
    expect(before.missing).toEqual(["model.credential_id", "model.model_name"]);

    // Following the template, the overview is not the customer's.
    const prompt = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "paused",
        config: {
          ...before.config,
          overview: { ...before.config.overview, agent_name: "Outra" },
        },
      }),
    ).catch((err: unknown) => err);
    expect(prompt).toBeInstanceOf(ConfigValidationError);
    expect(
      (prompt as ConfigValidationError).fieldErrors["overview.agent_name"],
    ).toBeDefined();

    const saved = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "active",
        config: {
          ...before.config,
          model: {
            credential_id: key.id,
            model_provider: "openai",
            model_name: "openai/gpt-4o-mini",
          },
        },
      }),
    );
    expect(saved.status).toBe("active");
    expect(saved.missing).toEqual([]);
    // The provider follows the key.
    expect(saved.config.model.model_provider).toBe("openrouter");

    const audit = await admin.auditEvent.findFirst({
      where: { action: "ai_agents.guid.update", resourceId: guid.id },
    });
    expect(audit?.metadata).toMatchObject({
      from: { status: "draft" },
      to: { status: "active" },
    });

    // A key of another workspace is refused.
    const foreign = await run(contextB, (tx) =>
      registerCredential(tx, contextB, {
        provider: "openrouter",
        label: LABEL,
        secret: SECRET,
      }),
    );
    const error = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "active",
        config: {
          ...saved.config,
          model: { ...saved.config.model, credential_id: foreign.id },
        },
      }),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConfigValidationError);
  });

  it("keeps a failing key off until it is tested or changed", async () => {
    const { guid, key } = await newGuid();
    const before = await run(contextA, (tx) => getGuid(tx, contextA, guid.id));
    const config = {
      ...before.config,
      model: { credential_id: key.id, model_name: "openai/gpt-4o-mini" },
    };
    await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, { status: "paused", config }),
    );
    await admin.$executeRawUnsafe(
      `update public.ai_agents set key_state = 'failed', status = 'paused' where id = '${guid.id}'`,
    );
    const blocked = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, { status: "active", config }),
    ).catch((err: unknown) => err);
    expect(blocked).toBeInstanceOf(ConfigValidationError);
    expect(
      (blocked as ConfigValidationError).fieldErrors["model.credential_id"],
    ).toBe("Teste a chave antes de ativar o agente.");
  });

  it("customizes the GUIDS, and only then edits the overview and the referrals", async () => {
    const { guid } = await newGuid();
    const referral = {
      name: "Dra. Ana",
      referralTag: "dra-ana",
      specialties: ["Ortodontia"],
      phone: "",
      city: "Curitiba",
      remote: false,
    };
    await expect(
      run(contextA, (tx) => createReferral(tx, contextA, guid.id, referral)),
    ).rejects.toMatchObject({ code: "conflict" });

    const custom = await run(contextA, (tx) =>
      customizeGuid(tx, contextA, guid.id),
    );
    expect(custom).toMatchObject({
      customized: true,
      editor: "customer_custom",
    });
    const renamed = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "paused",
        config: {
          ...custom.config,
          overview: { ...custom.config.overview, agent_name: "Ana Clara" },
        },
      }),
    );
    expect(renamed.name).toBe("Ana Clara");
    // Tools stay the partner's, even customized.
    const tools = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "paused",
        config: { ...renamed.config, integration: { tools: [] } },
      }),
    ).catch((err: unknown) => err);
    expect(
      (tools as ConfigValidationError).fieldErrors["integration.tools"],
    ).toBeDefined();

    const created = await run(contextA, (tx) =>
      createReferral(tx, contextA, guid.id, referral),
    );
    const updated = await run(contextA, (tx) =>
      updateReferral(tx, contextA, guid.id, created.id, {
        ...referral,
        remote: true,
      }),
    );
    expect(updated.remote).toBe(true);
    const repeated = await run(contextA, (tx) =>
      createReferral(tx, contextA, guid.id, referral),
    ).catch((err: unknown) => err);
    expect(
      (repeated as ConfigValidationError).fieldErrors.referralTag,
    ).toBeDefined();
    expect(
      (await run(contextA, (tx) => getGuid(tx, contextA, guid.id))).referrals,
    ).toHaveLength(1);
    await run(contextA, (tx) =>
      deleteReferral(tx, contextA, guid.id, created.id),
    );
  });

  it("deletes a GUIDS; another workspace and a viewer cannot touch it", async () => {
    const { guid } = await newGuid();
    await expect(
      run(contextB, (tx) => getGuid(tx, contextB, guid.id)),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      run(contextB, (tx) => deleteGuid(tx, contextB, guid.id)),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      run(contextMultiOrgInA, (tx) => getGuid(tx, contextMultiOrgInA, guid.id)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await run(contextA, (tx) => deleteGuid(tx, contextA, guid.id));
    expect(await admin.aiAgent.count({ where: { id: guid.id } })).toBe(0);
    const audit = await admin.auditEvent.findFirst({
      where: { action: "ai_agents.guid.delete", resourceId: guid.id },
    });
    expect(audit?.metadata).toMatchObject({ name: "Anna" });
  });
});
