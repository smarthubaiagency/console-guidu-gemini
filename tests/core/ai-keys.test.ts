import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getBackupSettings,
  listPartnerCredentials,
  registerPartnerCredential,
  resolveBackupKey,
  resolvePartnerKey,
  revokePartnerCredential,
  saveBackupSettings,
} from "@/core/ai/keys";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { PartnerRoleKey } from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A2a: the admin key in the partner's vault and the platform backup key.
 * The secret never comes back in a DTO; only the engine resolves it.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "b2a00000-0000-4000-8000-000000000001";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";
const SECRET = "sk-or-v1-0123456789abcdef0123456789";

describeDatabase("A2a: engine keys", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const asPartner = <T>(
    userId: string,
    partnerRole: PartnerRoleKey | null,
    op: (
      tx: ContextTransaction,
      actor: { userId: string; partnerRole: PartnerRoleKey | null },
    ) => Promise<T>,
  ) =>
    withIdentityContext(
      prisma,
      userId,
      (tx) => op(tx, { userId, partnerRole }),
      {
        partnerId: PARTNER,
      },
    );
  const asPlatform = <T>(
    userId: string,
    op: (tx: ContextTransaction) => Promise<T>,
  ) => withIdentityContext(prisma, userId, op);

  async function cleanup() {
    await admin.$executeRawUnsafe(`delete from public.platform_ai_settings`);
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${PARTNER}', 'agencia-a2a', 'Agência A2a')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
         ('${PARTNER}', '${ids.userA}', 'owner@a2a.test', 'partner_owner'),
         ('${PARTNER}', '${ids.userB}', 'support@a2a.test', 'partner_support')`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("keeps the admin key encrypted and returns only its mask", async () => {
    const created = await asPartner(ids.userA, "partner_owner", (tx, actor) =>
      registerPartnerCredential(tx, actor, PARTNER, {
        provider: "openrouter",
        label: "Chave do Assistente",
        secret: SECRET,
      }),
    );
    expect(created).toMatchObject({
      provider: "openrouter",
      purpose: "all",
      status: "active",
    });
    expect(JSON.stringify(created)).not.toContain(SECRET);
    expect(created.maskedValue).not.toBe(SECRET);

    const row = await admin.partnerCredential.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.encryptedPayload).not.toContain(SECRET);

    const listed = await asPartner(ids.userA, "partner_owner", (tx, actor) =>
      listPartnerCredentials(tx, actor, PARTNER),
    );
    expect(listed.map((c) => c.id)).toEqual([created.id]);
    expect(JSON.stringify(listed)).not.toContain(SECRET);

    // Only the engine resolves the secret.
    const resolved = await asPartner(ids.userA, "partner_owner", (tx) =>
      resolvePartnerKey(tx, PARTNER, "openrouter"),
    );
    expect(resolved).toEqual({ provider: "openrouter", secret: SECRET });

    const audit = await admin.auditEvent.findFirst({
      where: {
        action: "partner.ai_credentials.create",
        resourceId: created.id,
      },
    });
    expect(audit?.result).toBe("success");
    expect(JSON.stringify(audit?.metadata)).not.toContain(SECRET);

    // A revoked key no longer resolves.
    await asPartner(ids.userA, "partner_owner", (tx, actor) =>
      revokePartnerCredential(tx, actor, PARTNER, created.id),
    );
    expect(
      await asPartner(ids.userA, "partner_owner", (tx) =>
        resolvePartnerKey(tx, PARTNER, "openrouter"),
      ),
    ).toBeNull();
    await expect(
      asPartner(ids.userA, "partner_owner", (tx, actor) =>
        revokePartnerCredential(tx, actor, PARTNER, created.id),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "not_found",
    );
  });

  it("refuses partner roles without the permission and malformed keys", async () => {
    await expect(
      asPartner(ids.userB, "partner_support", (tx, actor) =>
        listPartnerCredentials(tx, actor, PARTNER),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      asPartner(ids.userA, "partner_owner", (tx, actor) =>
        registerPartnerCredential(tx, actor, PARTNER, {
          provider: "anthropic",
          label: "Errada",
          secret: "sk-proj-0123456789abcdef",
        }),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "invalid_input",
    );
    // A support member forging the owner role is stopped by RLS.
    await expect(
      asPartner(ids.userB, "partner_owner", (tx, actor) =>
        registerPartnerCredential(tx, actor, PARTNER, {
          provider: "openrouter",
          label: "Forjada",
          secret: SECRET,
        }),
      ),
    ).rejects.toThrow();
  });

  it("saves the platform backup key and model, and clears the key", async () => {
    await expect(
      asPlatform(ids.userA, (tx) => getBackupSettings(tx, null)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const empty = await asPlatform(PLATFORM_OWNER, (tx) =>
      getBackupSettings(tx, "owner"),
    );
    expect(empty).toEqual({
      provider: null,
      maskedValue: null,
      model: null,
      updatedAt: null,
    });

    const saved = await asPlatform(PLATFORM_OWNER, (tx) =>
      saveBackupSettings(tx, PLATFORM_OWNER, "owner", {
        provider: "openrouter",
        secret: SECRET,
        model: "openai/gpt-cheap",
      }),
    );
    expect(saved).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-cheap",
    });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(
      await asPlatform(PLATFORM_OWNER, (tx) => resolveBackupKey(tx)),
    ).toEqual({
      provider: "openrouter",
      secret: SECRET,
      model: "openai/gpt-cheap",
    });

    // Changing only the model keeps the key.
    await asPlatform(PLATFORM_OWNER, (tx) =>
      saveBackupSettings(tx, PLATFORM_OWNER, "owner", {
        model: "openai/gpt-cheaper",
      }),
    );
    expect(
      await asPlatform(PLATFORM_OWNER, (tx) => resolveBackupKey(tx)),
    ).toMatchObject({ secret: SECRET, model: "openai/gpt-cheaper" });

    // A key needs its provider; clearing stops the backup.
    await expect(
      asPlatform(PLATFORM_OWNER, (tx) =>
        saveBackupSettings(tx, PLATFORM_OWNER, "owner", {
          secret: SECRET,
          model: "x",
        }),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "invalid_input",
    );
    await asPlatform(PLATFORM_OWNER, (tx) =>
      saveBackupSettings(tx, PLATFORM_OWNER, "owner", {
        model: "openai/gpt-cheaper",
        clearKey: true,
      }),
    );
    expect(
      await asPlatform(PLATFORM_OWNER, (tx) => resolveBackupKey(tx)),
    ).toBeNull();

    const audits = await admin.auditEvent.findMany({
      where: { action: "platform.ai_backup.update" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain(SECRET);
  });
});
