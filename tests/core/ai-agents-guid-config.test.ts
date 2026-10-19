import { PrismaClient } from "@prisma/client";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConfigValidationError } from "@/core/ai/templates";
import { runGuidTurn } from "@/core/ai/turn/guid";
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
  getGuidTestConversation,
  sendGuidTestMessage,
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
 * a viewer see nothing. A4b: it is turned on only after a successful test
 * of the configuration being saved.
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
    // The usage of the tests stays when a GUIDS is deleted (§9.3).
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
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

  /** "Testar agente": one message, answered by a mock model. */
  async function passTest(agentId: string) {
    const sent = await run(contextA, (tx) =>
      sendGuidTestMessage(tx, contextA, { agentId, text: "Olá" }),
    );
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            { type: "text", text: JSON.stringify({ messages: ["Oi!"] }) },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        },
      ],
    });
    return runGuidTurn(
      {
        jobRunId: sent.jobRunId,
        transaction: (op) => withContext(prisma, contextA, op),
      },
      contextA,
      sent,
      { createModel: () => model },
    );
  }

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

    // Following the template, the prompt is not the customer's (the name
    // is, since the GF1).
    const prompt = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "paused",
        config: {
          ...before.config,
          overview: { ...before.config.overview, system_prompt: "Outro" },
        },
      }),
    ).catch((err: unknown) => err);
    expect(prompt).toBeInstanceOf(ConfigValidationError);
    expect(
      (prompt as ConfigValidationError).fieldErrors["overview.system_prompt"],
    ).toBeDefined();

    const draft = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "paused",
        config: {
          ...before.config,
          // The business is the customer's too, without customizing.
          overview: {
            ...before.config.overview,
            business_summary: "Clínica de sorrisos.",
          },
          model: {
            credential_id: key.id,
            model_provider: "openai",
            model_name: "openai/gpt-4o-mini",
          },
        },
      }),
    );
    expect(draft).toMatchObject({ status: "draft", testedCurrent: false });
    expect(draft.missing).toEqual([]);
    expect(draft.config.overview.business_summary).toBe("Clínica de sorrisos.");
    // The provider follows the key.
    expect(draft.config.model.model_provider).toBe("openrouter");

    // Not tested yet: it stays a draft.
    const untested = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "active",
        config: draft.config,
      }),
    ).catch((err: unknown) => err);
    expect(untested).toBeInstanceOf(ConfigValidationError);
    expect((untested as ConfigValidationError).fieldErrors.active).toBe(
      "Teste o agente nesta configuração antes de ativá-lo.",
    );
    expect(
      (await run(contextA, (tx) => getGuid(tx, contextA, guid.id))).status,
    ).toBe("draft");

    await expect(passTest(guid.id)).resolves.toMatchObject({ tested: 1 });
    const chat = await run(contextA, (tx) =>
      getGuidTestConversation(tx, contextA, guid.id),
    );
    expect(chat?.waiting).toBe(false);
    expect(chat?.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Olá"],
      ["assistant", "Oi!"],
    ]);
    const tested = await run(contextA, (tx) => getGuid(tx, contextA, guid.id));
    expect(tested.testedCurrent).toBe(true);
    expect(tested.testedAt).not.toBeNull();

    const saved = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "active",
        config: tested.config,
      }),
    );
    expect(saved).toMatchObject({ status: "active", testedCurrent: true });

    const audit = await admin.auditEvent.findFirst({
      where: { action: "ai_agents.guid.update", resourceId: guid.id },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit?.metadata).toMatchObject({
      from: { status: "draft" },
      to: { status: "active" },
    });

    // CF6a: a model outside the catalog of the provider is refused.
    const outside = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "active",
        config: {
          ...saved.config,
          model: { ...saved.config.model, model_name: "openai/gpt-4.1" },
        },
      }),
    ).catch((err: unknown) => err);
    expect(
      (outside as { fieldErrors?: Record<string, string> }).fieldErrors,
    ).toEqual({ "model.model_name": "Escolha um modelo da lista." });

    // A change keeps it on, and asks for a new test.
    const changed = await run(contextA, (tx) =>
      updateGuid(tx, contextA, guid.id, {
        status: "active",
        config: {
          ...saved.config,
          model: { ...saved.config.model, model_name: "openai/gpt-5-mini" },
        },
      }),
    );
    expect(changed).toMatchObject({ status: "active", testedCurrent: false });

    // Only the engine records a test.
    await expect(
      run(contextA, (tx) =>
        tx.$executeRawUnsafe(
          `update public.ai_agents set tested_config_hash = md5(config::text), tested_at = now()
           where id = '${guid.id}'`,
        ),
      ),
    ).rejects.toThrow(/recorded only by the engine/);

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

  it("takes a voice key that speaks, a voice of its list and an embeddings key (A5d)", async () => {
    const { guid, key } = await newGuid();
    const voiceKey = await run(contextA, (tx) =>
      registerCredential(tx, contextA, {
        provider: "openai",
        label: LABEL,
        secret: "sk-proj-0123456789abcdef0123456789",
        purpose: "chat",
      }),
    );
    const before = await run(contextA, (tx) => getGuid(tx, contextA, guid.id));
    const save = (model: Record<string, unknown>) =>
      run(contextA, (tx) =>
        updateGuid(tx, contextA, guid.id, {
          status: "paused",
          config: {
            ...before.config,
            model: {
              credential_id: key.id,
              model_name: "openai/gpt-4o-mini",
              ...model,
            },
          },
        }),
      ).catch((err: unknown) => err);

    // An OpenRouter key has no voice.
    const silent = await save({ audio_credential_id: key.id });
    expect(
      (silent as ConfigValidationError).fieldErrors[
        "model.audio_credential_id"
      ],
    ).toBe("Escolha uma chave OpenAI ou Gemini para a voz.");
    const wrongVoice = await save({
      audio_credential_id: voiceKey.id,
      audio_voice: "Kore",
    });
    expect(
      (wrongVoice as ConfigValidationError).fieldErrors["model.audio_voice"],
    ).toBe("Escolha uma voz da lista.");
    // A key only for chat does not embed.
    const noEmbeddings = await save({ embedding_credential_id: voiceKey.id });
    expect(
      (noEmbeddings as ConfigValidationError).fieldErrors[
        "model.embedding_credential_id"
      ],
    ).toBe("A chave escolhida não está ativa no cofre.");

    const saved = await save({
      audio_credential_id: voiceKey.id,
      audio_voice: "nova",
      embedding_credential_id: key.id,
    });
    expect(saved).toMatchObject({
      config: {
        model: {
          audio_credential_id: voiceKey.id,
          audio_voice: "nova",
          embedding_credential_id: key.id,
          model_provider: "openrouter",
        },
      },
    });
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
