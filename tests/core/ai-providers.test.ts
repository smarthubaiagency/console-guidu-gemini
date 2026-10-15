import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aiPolicy, modelChoiceFieldErrors } from "@/core/ai/catalog";
import { partnerAiDashboard, platformAiDashboard } from "@/core/ai/dashboard";
import { DEFAULT_MODEL_CATALOG } from "@/core/ai/models";
import { aiProvidersView, saveAiProviders } from "@/core/ai/provider-settings";
import { registerCredential } from "@/core/credentials/vault";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF6a: providers and models in the settings cascade (the platform turns
 * them on and keeps the catalog, the partner narrows, the customer sees
 * what is left), the vault refusing a provider turned off, and the AI
 * dashboards from the usage (failed calls included).
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "bcf6a000-0000-4000-8000-000000000001";
const HOUSE = "00000000-0000-4000-8000-000000000000";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const EXECUTION = "bcf6a000-0000-4000-8000-0000000000e1";
const SECRET = "sk-or-v1-0123456789abcdef0123456789";

describeDatabase("CF6a: AI providers and models", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const platform = {
    level: "platform",
    userId: PLATFORM_OWNER,
    platformRole: "owner",
  } as const;
  const partnerOwner = {
    level: "partner",
    userId: ids.userA,
    partnerId: PARTNER,
    partnerRole: "partner_owner",
  } as const;
  const partnerSupport = {
    level: "partner",
    userId: ids.userB,
    partnerId: PARTNER,
    partnerRole: "partner_support",
  } as const;
  const workspaceOwner: RequestContext = { ...contextB, principalType: "user" };

  const inPlatform = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, PLATFORM_OWNER, op);
  const inPartner = <T>(
    userId: string,
    op: (tx: ContextTransaction) => Promise<T>,
  ) => withIdentityContext(prisma, userId, op, { partnerId: PARTNER });
  const inWorkspace = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withContext(prisma, workspaceOwner, op);

  const codeOf = (err: unknown) =>
    err instanceof AppError ? err.messageKey : String(err);

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.settings where key like 'ai.%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.ai_usage_events where execution_id = '${EXECUTION}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.credentials where workspace_id = '${ids.workspaceB}' and label like 'CF6a%'`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${HOUSE}'
       where id = '${ids.organizationB}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name)
       values ('${PARTNER}', 'agencia-cf6a', 'Agência CF6a')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
         ('${PARTNER}', '${ids.userA}', 'owner@cf6a.test', 'partner_owner'),
         ('${PARTNER}', '${ids.userB}', 'support@cf6a.test', 'partner_support')`,
    );
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${PARTNER}'
       where id = '${ids.organizationB}'`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("starts with every provider and the seeded catalog", async () => {
    const policy = await inWorkspace((tx) => aiPolicy(tx));
    expect(policy.providers).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "openrouter",
    ]);
    expect(policy.models).toEqual(DEFAULT_MODEL_CATALOG);
  });

  it("lets the platform turn providers on, keep the catalog and set a gateway", async () => {
    const refused = await inPlatform((tx) =>
      saveAiProviders(tx, platform, {
        providers: ["openai"],
        models: {},
        baseUrls: { openai: "http://gateway.example.com/v1" },
      }),
    ).catch((err: unknown) => err);
    expect(codeOf(refused)).toBe("aiConsole.providersPage.errors.baseUrl");
    const none = await inPlatform((tx) =>
      saveAiProviders(tx, platform, { providers: [], models: {} }),
    ).catch((err: unknown) => err);
    expect(codeOf(none)).toBe("aiConsole.providersPage.errors.noProvider");

    const view = await inPlatform((tx) =>
      saveAiProviders(tx, platform, {
        providers: ["openai", "anthropic", "openrouter"],
        models: {
          openai: ["gpt-5-mini", "gpt-5"],
          anthropic: ["claude-haiku-5-5"],
          openrouter: [],
        },
        baseUrls: { openai: "https://gateway.example.com/v1/", anthropic: "" },
      }),
    );
    expect(view.effective.providers).toEqual([
      "openai",
      "anthropic",
      "openrouter",
    ]);
    expect(view.baseUrls).toEqual({ openai: "https://gateway.example.com/v1" });

    // The partner support reads, never writes.
    const read = await inPartner(ids.userB, (tx) =>
      aiProvidersView(tx, partnerSupport),
    );
    expect(read.canEdit).toBe(false);
    expect(read.inherited.providers).toEqual([
      "openai",
      "anthropic",
      "openrouter",
    ]);
    expect(read.baseUrls).toEqual({});
    await expect(
      inPartner(ids.userB, (tx) =>
        saveAiProviders(tx, partnerSupport, {
          providers: ["openai"],
          models: {},
        }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("lets the partner narrow, never widen, what its customers choose", async () => {
    const widen = await inPartner(ids.userA, (tx) =>
      saveAiProviders(tx, partnerOwner, {
        providers: ["openai", "gemini"],
        models: {},
      }),
    ).catch((err: unknown) => err);
    expect(codeOf(widen)).toBe("aiConsole.providersPage.errors.notOffered");
    const foreignModel = await inPartner(ids.userA, (tx) =>
      saveAiProviders(tx, partnerOwner, {
        providers: ["openai"],
        models: { openai: ["gpt-4o"] },
      }),
    ).catch((err: unknown) => err);
    expect(codeOf(foreignModel)).toBe(
      "aiConsole.providersPage.errors.notOffered",
    );

    const view = await inPartner(ids.userA, (tx) =>
      saveAiProviders(tx, partnerOwner, {
        providers: ["openai", "openrouter"],
        models: {
          openai: ["gpt-5"],
          // Free on the platform: the partner may list its own.
          openrouter: ["openai/gpt-4o-mini"],
        },
      }),
    );
    expect(view.effective).toEqual({
      providers: ["openai", "openrouter"],
      models: {
        openai: ["gpt-5"],
        anthropic: ["claude-haiku-5-5"],
        openrouter: ["openai/gpt-4o-mini"],
      },
    });

    // The customer of the partner sees what is left.
    const customer = await inWorkspace((tx) => aiPolicy(tx));
    expect(customer).toEqual(view.effective);
  });

  it("refuses a key of a provider turned off and a model outside the list", async () => {
    const off = await inWorkspace((tx) =>
      registerCredential(tx, workspaceOwner, {
        provider: "anthropic",
        label: "CF6a desligado",
        secret: "sk-ant-0123456789abcdef0123456789",
      }),
    ).catch((err: unknown) => err);
    expect(codeOf(off)).toBe("aiConsole.errors.providerOff");
    const ok = await inWorkspace((tx) =>
      registerCredential(tx, workspaceOwner, {
        provider: "openrouter",
        label: "CF6a ligado",
        secret: SECRET,
      }),
    );
    expect(ok.provider).toBe("openrouter");

    const errors = await inWorkspace((tx) =>
      modelChoiceFieldErrors(
        tx,
        { provider: "openrouter", model: "openai/gpt-4o-mini" },
        { provider: "openrouter", model: "anthropic/claude-sonnet-5-5" },
      ),
    );
    expect(errors).toEqual({
      "model.model_name": "Escolha um modelo da lista.",
    });
    // What was saved before the catalog keeps working while unchanged.
    const kept = await inWorkspace((tx) =>
      modelChoiceFieldErrors(
        tx,
        { provider: "anthropic", model: "claude-opus-5-5" },
        { provider: "anthropic", model: "claude-opus-5-5" },
      ),
    );
    expect(kept).toEqual({});
  });

  it("shows usage and errors to the platform by partner and to the partner by customer", async () => {
    const row = (inputTokens: number, errorCode: string | null) => ({
      executionId: EXECUTION,
      organizationId: ids.organizationB,
      workspaceId: ids.workspaceB,
      keySource: "customer",
      provider: "openai",
      model: "gpt-5",
      inputTokens,
      outputTokens: errorCode ? 0 : 10,
      errorCode,
    });
    await admin.aiUsageEvent.createMany({
      data: [
        row(100, null),
        row(200, null),
        row(0, "provider_auth"),
        {
          executionId: EXECUTION,
          partnerId: PARTNER,
          keySource: "admin",
          provider: "openrouter",
          model: "openai/gpt-4o-mini",
          inputTokens: 50,
          outputTokens: 5,
        },
      ],
    });

    const house = await inPlatform((tx) => platformAiDashboard(tx, "owner", 7));
    const mine = house.groups.find((g) => g.id === PARTNER);
    expect(mine).toMatchObject({
      name: "Agência CF6a",
      requests: 3,
      errors: 1,
      inputTokens: 350,
    });
    await expect(
      inPlatform((tx) => platformAiDashboard(tx, "support", 7)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const partner = await inPartner(ids.userA, (tx) =>
      partnerAiDashboard(
        tx,
        { partnerId: PARTNER, partnerRole: "partner_owner" },
        30,
      ),
    );
    expect(partner.groups.map((g) => [g.id, g.requests, g.errors])).toEqual([
      [ids.organizationB, 2, 1],
      [null, 1, 0],
    ]);
    expect(
      partner.providers.find((p) => p.provider === "openai"),
    ).toMatchObject({ requests: 2, errors: 1, topError: "provider_auth" });

    // The support of the partner sees the customers, not the admin key.
    const support = await inPartner(ids.userB, (tx) =>
      partnerAiDashboard(
        tx,
        { partnerId: PARTNER, partnerRole: "partner_support" },
        30,
      ),
    );
    expect(support.groups.map((g) => g.id)).toEqual([ids.organizationB]);
  });
});
