import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { listGuids } from "@/modules/ai-agents/server";
import { ensureFactoryGuids } from "@/modules/ai-agents/server/services/factory";
import {
  deleteGuid,
  getGuid,
  restoreFactoryPrompt,
  setGuidAvatar,
} from "@/modules/ai-agents/server/services/guid-config";
import { AppError } from "@/shared/errors";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * GF1: the four factory GUIDS — created as drafts when missing, within the
 * plan limit, never deleted (one that goes away comes back off), with the
 * attendant born customized, the avatar of the gallery and "Restaurar
 * prompt de fábrica".
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";

describeDatabase("GF1: factory GUIDS", requiredVars, () => {
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

  it("creates the four as drafts, the attendant customized, once", async () => {
    const seed = await run(contextA, (tx) => ensureFactoryGuids(tx, contextA));
    expect(seed.created.sort()).toEqual(
      ["attendant", "ops", "orchestrator", "seller"].sort(),
    );
    expect(seed.skipped).toEqual([]);

    const guids = await run(contextA, (tx) => listGuids(tx, contextA));
    expect(guids).toHaveLength(4);
    const byRole = new Map(guids.map((g) => [g.factoryRole, g]));
    expect(byRole.get("orchestrator")).toMatchObject({
      name: "Recepção",
      status: "draft",
      customized: false,
      avatar: "headset:info",
    });
    expect(byRole.get("attendant")).toMatchObject({
      name: "Atendente",
      customized: true,
    });
    expect(byRole.get("seller")?.name).toBe("Vendedor");
    expect(byRole.get("ops")?.name).toBe("Ops");

    // The prompt of the template is copied into the configuration.
    const ops = await run(contextA, (tx) =>
      getGuid(tx, contextA, byRole.get("ops")!.id),
    );
    expect(ops.config.overview.system_prompt).toContain("@guidu");

    // Again: nothing new.
    const again = await run(contextA, (tx) => ensureFactoryGuids(tx, contextA));
    expect(again).toEqual({ created: [], skipped: [] });
  });

  it("fills a smaller limit with the front door first", async () => {
    await limit(2);
    const seed = await run(contextA, (tx) => ensureFactoryGuids(tx, contextA));
    expect(seed.created).toEqual(["orchestrator", "attendant"]);
    expect(seed.skipped).toEqual(["seller", "ops"]);
  });

  it("never deletes a factory GUIDS, and one that went away comes back off", async () => {
    await run(contextA, (tx) => ensureFactoryGuids(tx, contextA));
    const seller = (await run(contextA, (tx) => listGuids(tx, contextA))).find(
      (g) => g.factoryRole === "seller",
    )!;
    await expect(
      run(contextA, (tx) => deleteGuid(tx, contextA, seller.id)),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<AppError>);

    // Gone by another way (purge, the database): back as a draft.
    await admin.$executeRawUnsafe(
      `delete from public.ai_agents where id = '${seller.id}'`,
    );
    const seed = await run(contextA, (tx) => ensureFactoryGuids(tx, contextA));
    expect(seed.created).toEqual(["seller"]);
    const back = (await run(contextA, (tx) => listGuids(tx, contextA))).find(
      (g) => g.factoryRole === "seller",
    );
    expect(back).toMatchObject({ status: "draft" });
  });

  it("keeps the avatar of the gallery and restores the factory prompt", async () => {
    await run(contextA, (tx) => ensureFactoryGuids(tx, contextA));
    const orchestrator = (
      await run(contextA, (tx) => listGuids(tx, contextA))
    ).find((g) => g.factoryRole === "orchestrator")!;

    const saved = await run(contextA, (tx) =>
      setGuidAvatar(tx, contextA, orchestrator.id, "store:success"),
    );
    expect(saved.avatar).toBe("store:success");
    await expect(
      run(contextA, (tx) =>
        setGuidAvatar(tx, contextA, orchestrator.id, "rocket:pink"),
      ),
    ).rejects.toThrow();

    const original = (
      await run(contextA, (tx) => getGuid(tx, contextA, orchestrator.id))
    ).config.overview.system_prompt;
    await admin.$executeRawUnsafe(
      `update public.ai_agents
       set config = jsonb_set(config, '{overview,system_prompt}', '"Outro prompt"')
       where id = '${orchestrator.id}'`,
    );
    const restored = await run(contextA, (tx) =>
      restoreFactoryPrompt(tx, contextA, orchestrator.id),
    );
    expect(restored.config.overview.system_prompt).toBe(original);
    expect(restored.testedCurrent).toBe(false);
  });

  it("creates only in the workspace of the request", async () => {
    await run(contextA, (tx) => ensureFactoryGuids(tx, contextA));
    const other = await run(contextB, (tx) => listGuids(tx, contextB));
    expect(other).toHaveLength(0);
  });
});
