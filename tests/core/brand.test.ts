import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadActiveBrand, loadBrandLogo } from "@/core/brand/resolve";
import { saveBrandVersion } from "@/core/brand/service";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

/** Active platform owner from tests/core/admin-seed.sql. */
const platformOwnerId = "d0000000-0000-4000-8000-000000000003";
const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
]);

describeDatabase("P3: partner brand versions (ADR 0012)", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const save = (
    userId: string,
    role: "owner" | null,
    input: Parameters<typeof saveBrandVersion>[3],
    logo: Parameters<typeof saveBrandVersion>[4] = { kind: "keep" },
  ) =>
    withIdentityContext(
      prisma,
      userId,
      (tx) =>
        saveBrandVersion(
          tx,
          { userId, platformRole: role },
          HOUSE_PARTNER_ID,
          input,
          logo,
        ),
      { partnerId: HOUSE_PARTNER_ID },
    );

  beforeAll(async () => {
    await admin.$executeRawUnsafe("delete from public.partner_brands");
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe("delete from public.partner_brands");
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("falls back to the environment brand without versions", async () => {
    const brand = await loadActiveBrand(prisma, HOUSE_PARTNER_ID);
    expect(brand.source).toBe("environment");
    expect(brand.palette).toBeNull();
  });

  it("refuses users without the platform brand permission", async () => {
    await expect(
      save(ids.userA, null, { displayName: "Intruso" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("validates color and logo before writing", async () => {
    await expect(
      save(platformOwnerId, "owner", {
        displayName: "GUIDU",
        primaryColor: "azul",
      }),
    ).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === "invalid_input",
    );
    await expect(
      save(
        platformOwnerId,
        "owner",
        { displayName: "GUIDU" },
        { kind: "replace", bytes: new TextEncoder().encode("<svg/>") },
      ),
    ).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === "invalid_input",
    );
  });

  it("creates versions, keeps the logo and serves the active brand", async () => {
    const first = await save(
      platformOwnerId,
      "owner",
      {
        displayName: "Marca Teste",
        primaryColor: "#FFEB3B",
        supportEmail: "suporte@guidu.com.br",
      },
      { kind: "replace", bytes: png },
    );
    expect(first.version).toBe(1);

    const second = await save(platformOwnerId, "owner", {
      displayName: "Marca Teste 2",
      primaryColor: "#ffeb3b",
    });
    expect(second.version).toBe(2);

    const brand = await loadActiveBrand(prisma, HOUSE_PARTNER_ID);
    expect(brand).toMatchObject({
      source: "partner",
      version: 2,
      name: "Marca Teste 2",
      primaryColor: "#ffeb3b",
      supportEmail: null,
      logoUrl: "/brand/logo/2",
    });
    expect(brand.palette?.onPrimary).toBe("#000000");

    const logo = await loadBrandLogo(prisma, HOUSE_PARTNER_ID, 2);
    expect(logo?.mime).toBe("image/png");
    expect(Array.from(logo?.bytes ?? [])).toEqual(Array.from(png));

    const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
      "select count(*) from public.audit_events where action = 'partner.brand.update'",
    );
    expect(Number(count)).toBeGreaterThanOrEqual(2);
  });

  it("removes the logo when asked", async () => {
    await save(
      platformOwnerId,
      "owner",
      { displayName: "Marca Teste 3" },
      { kind: "remove" },
    );
    const brand = await loadActiveBrand(prisma, HOUSE_PARTNER_ID);
    expect(brand.logoUrl).toBeNull();
    expect(brand.palette).toBeNull();
  });

  it("does not expose the house brand to another partner context", async () => {
    const other = await loadActiveBrand(
      prisma,
      "00000000-0000-4000-8000-0000000000ff",
    );
    expect(other.source).toBe("environment");
  });
});
