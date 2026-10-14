import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  loadActiveBrand,
  loadBrandImage,
  loadBrandLogo,
} from "@/core/brand/resolve";
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
    images: Parameters<typeof saveBrandVersion>[5] = {},
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
          images,
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

  it("saves the CF2 fields and copies kept images to the next version", async () => {
    const square = new Uint8Array(33);
    square.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(square.buffer).setUint32(16, 32);
    new DataView(square.buffer).setUint32(20, 32);

    const { version } = await save(
      platformOwnerId,
      "owner",
      {
        displayName: "Marca CF2",
        tagline: "Atendimento que vende",
        footerText: "GUIDU Ltda. https://guidu.com.br",
        whatsappNumber: "+55 (11) 99999-9999",
        whatsappLabel: "Fale com vendas",
        whatsappMessage: "Olá",
      },
      { kind: "keep" },
      {
        logoDark: { kind: "replace", bytes: png },
        favicon: { kind: "replace", bytes: square },
        shareImage: { kind: "replace", bytes: png },
      },
    );
    const next = await save(platformOwnerId, "owner", {
      displayName: "Marca CF2",
    });
    expect(next.version).toBe(version + 1);

    const brand = await loadActiveBrand(prisma, HOUSE_PARTNER_ID);
    expect(brand).toMatchObject({
      logoDarkUrl: `/brand/logo-dark/${next.version}`,
      faviconUrl: `/brand/favicon/${next.version}`,
      shareImageUrl: `/brand/share/${next.version}`,
      // Text fields are what the form sends: cleared ones are cleared.
      tagline: null,
      whatsapp: null,
    });
    const favicon = await loadBrandImage(
      prisma,
      HOUSE_PARTNER_ID,
      next.version,
      "favicon",
    );
    expect(favicon?.mime).toBe("image/png");

    const saved = await loadActiveBrand(prisma, HOUSE_PARTNER_ID);
    expect(saved.version).toBe(next.version);
    const previous = await admin.$queryRawUnsafe<
      [{ whatsapp_number: string; tagline: string }]
    >(
      `select whatsapp_number, tagline from public.partner_brands
       where partner_id = '${HOUSE_PARTNER_ID}' and version = ${version}`,
    );
    expect(previous[0]).toEqual({
      whatsapp_number: "5511999999999",
      tagline: "Atendimento que vende",
    });
  });

  it("validates the CF2 fields", async () => {
    const fails = (promise: Promise<unknown>, messageKey: string) =>
      expect(promise).rejects.toSatisfy(
        (e) =>
          e instanceof AppError &&
          e.code === "invalid_input" &&
          e.messageKey === messageKey,
      );
    await fails(
      save(platformOwnerId, "owner", {
        displayName: "X",
        whatsappNumber: "123",
      }),
      "brand.errors.invalidWhatsapp",
    );
    await fails(
      save(platformOwnerId, "owner", {
        displayName: "X",
        whatsappLabel: "Vendas",
      }),
      "brand.errors.whatsappRequired",
    );
    await fails(
      save(
        platformOwnerId,
        "owner",
        { displayName: "X" },
        { kind: "keep" },
        { favicon: { kind: "replace", bytes: png } },
      ),
      "brand.errors.faviconUnsupportedType",
    );
  });

  it("does not expose the house brand to another partner context", async () => {
    const other = await loadActiveBrand(
      prisma,
      "00000000-0000-4000-8000-0000000000ff",
    );
    expect(other.source).toBe("environment");
  });
});
