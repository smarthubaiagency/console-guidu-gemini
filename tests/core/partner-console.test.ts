import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Identity } from "@/core/auth/identity";
import { loadActiveBrand } from "@/core/brand/resolve";
import { saveBrandVersion } from "@/core/brand/service";
import {
  acceptPartnerInvitation,
  createPartnerInvitation,
  getPartnerInvitationView,
} from "@/core/partners/invitations";
import {
  addPartnerDomain,
  createPartner,
  listPartners,
  setPartnerDomainStatus,
  setPartnerStatus,
} from "@/core/partners/management";
import {
  getPartnerMembership,
  listPartnerCustomers,
  listPartnerMembers,
  updatePartnerMember,
} from "@/core/partners/members";
import { resolvePartnerForHost } from "@/core/partners/resolve";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

/** Fixtures (tests/core/membership-seed.sql, admin-seed.sql). */
const platformOwner = "d0000000-0000-4000-8000-000000000003";
const ownerUser = "d0000000-0000-4000-8000-000000000004";
const financeUser = "d0000000-0000-4000-8000-000000000005";
const outsider = "d0000000-0000-4000-8000-000000000006";
const orgB = "a0000000-0000-4000-8000-000000000020";

function identity(userId: string, email: string): Identity {
  return {
    userId,
    email,
    emailConfirmedAt: new Date().toISOString(),
    mfaSatisfied: true,
    profile: { id: userId } as Identity["profile"],
  };
}

function isAppError(code: string) {
  return (e: unknown) => e instanceof AppError && e.code === code;
}

describeDatabase("P4a: partner console (ADR 0012)", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const platformActor = { userId: platformOwner, role: "owner" as const };
  let partnerId = "";

  async function cleanup() {
    await admin.$executeRawUnsafe(
      "update public.organizations set partner_id = '00000000-0000-4000-8000-000000000000' where partner_id <> '00000000-0000-4000-8000-000000000000'",
    );
    await admin.$executeRawUnsafe(
      "delete from public.partners where slug = 'agencia-teste'",
    );
  }

  beforeAll(async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    await cleanup();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("lets only platform owner/operations create and manage partners", async () => {
    await expect(
      withIdentityContext(prisma, outsider, (tx) =>
        createPartner(
          tx,
          { userId: outsider, role: null },
          {
            name: "X",
            slug: "x",
          },
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    ({ id: partnerId } = await withIdentityContext(
      prisma,
      platformOwner,
      (tx) =>
        createPartner(tx, platformActor, {
          name: "Agência Teste",
          slug: "Agencia-Teste",
        }),
    ));

    await expect(
      withIdentityContext(prisma, platformOwner, (tx) =>
        createPartner(tx, platformActor, {
          name: "Outra",
          slug: "agencia-teste",
        }),
      ),
    ).rejects.toSatisfy(isAppError("conflict"));

    const partners = await withIdentityContext(prisma, platformOwner, (tx) =>
      listPartners(tx, platformActor),
    );
    expect(partners.find((p) => p.isHouse)).toBeDefined();
    expect(partners.find((p) => p.id === partnerId)?.slug).toBe(
      "agencia-teste",
    );
  });

  it("registers domains as pending and resolves them only once active", async () => {
    await expect(
      withIdentityContext(prisma, platformOwner, (tx) =>
        addPartnerDomain(tx, platformActor, partnerId, {
          host: "localhost",
          kind: "custom",
        }),
      ),
    ).rejects.toSatisfy(isAppError("invalid_input"));

    await withIdentityContext(prisma, platformOwner, (tx) =>
      addPartnerDomain(tx, platformActor, partnerId, {
        host: "App.Agencia-Teste.localhost",
        kind: "custom",
      }),
    );
    expect(
      await resolvePartnerForHost(prisma, "app.agencia-teste.localhost"),
    ).toBeNull();

    await withIdentityContext(prisma, platformOwner, (tx) =>
      setPartnerDomainStatus(
        tx,
        platformActor,
        "app.agencia-teste.localhost",
        "active",
      ),
    );
    expect(
      await resolvePartnerForHost(prisma, "app.agencia-teste.localhost:3000"),
    ).toMatchObject({ partnerId, isPlatformHost: false });

    // Platform subdomain: just the name, under the base (localhost here).
    const { host } = await withIdentityContext(prisma, platformOwner, (tx) =>
      addPartnerDomain(tx, platformActor, partnerId, {
        host: "Agencia-Teste",
        kind: "subdomain",
      }),
    );
    expect(host).toBe("agencia-teste.localhost");
    await expect(
      withIdentityContext(prisma, platformOwner, (tx) =>
        addPartnerDomain(tx, platformActor, partnerId, {
          host: "app.outro.com.br",
          kind: "subdomain",
        }),
      ),
    ).rejects.toSatisfy(isAppError("invalid_input"));
  });

  it("invites the owner from the platform and accepts with the invited e-mail", async () => {
    const { rawToken, inviteUrl } = await withIdentityContext(
      prisma,
      platformOwner,
      (tx) =>
        createPartnerInvitation(
          tx,
          { userId: platformOwner, platformRole: "owner", partnerRole: null },
          partnerId,
          { email: "Dono@Agencia-Teste.com.br", role: "partner_owner" },
          "http://app.agencia-teste.localhost:3000",
        ),
    );
    expect(inviteUrl).toBe(
      `http://app.agencia-teste.localhost:3000/partner-invite/${rawToken}`,
    );

    const wrong = identity(ownerUser, "outro@agencia-teste.com.br");
    expect(
      (await getPartnerInvitationView(prisma, wrong, rawToken)).status,
    ).toBe("recipient_mismatch");
    await expect(
      acceptPartnerInvitation(prisma, wrong, rawToken),
    ).rejects.toSatisfy(isAppError("forbidden"));

    const owner = identity(ownerUser, "dono@agencia-teste.com.br");
    expect(
      await getPartnerInvitationView(prisma, owner, rawToken),
    ).toMatchObject({
      status: "valid",
      partnerName: "Agência Teste",
      role: "partner_owner",
    });
    await acceptPartnerInvitation(prisma, owner, rawToken);
    expect(
      (await getPartnerInvitationView(prisma, owner, rawToken)).status,
    ).toBe("accepted");

    expect(
      await getPartnerMembership(prisma, ownerUser, partnerId),
    ).toMatchObject({ role: "partner_owner", partnerName: "Agência Teste" });
    expect(await getPartnerMembership(prisma, outsider, partnerId)).toBeNull();
  });

  it("lets the partner owner invite and manage members inside the partner", async () => {
    const inPartner = <T>(
      userId: string,
      fn: Parameters<typeof withIdentityContext<T>>[2],
    ) => withIdentityContext(prisma, userId, fn, { partnerId });

    const { rawToken } = await inPartner(ownerUser, (tx) =>
      createPartnerInvitation(
        tx,
        { userId: ownerUser, platformRole: null, partnerRole: "partner_owner" },
        partnerId,
        { email: "financeiro@agencia-teste.com.br", role: "partner_finance" },
        "http://app.agencia-teste.localhost:3000",
      ),
    );
    await acceptPartnerInvitation(
      prisma,
      identity(financeUser, "financeiro@agencia-teste.com.br"),
      rawToken,
    );

    // A finance member cannot invite or manage.
    await expect(
      inPartner(financeUser, (tx) =>
        createPartnerInvitation(
          tx,
          {
            userId: financeUser,
            platformRole: null,
            partnerRole: "partner_finance",
          },
          partnerId,
          { email: "x@agencia-teste.com.br", role: "partner_owner" },
          "http://x",
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await inPartner(ownerUser, (tx) =>
      updatePartnerMember(
        tx,
        { userId: ownerUser, partnerRole: "partner_owner" },
        partnerId,
        financeUser,
        { role: "partner_support" },
      ),
    );
    await expect(
      inPartner(ownerUser, (tx) =>
        updatePartnerMember(
          tx,
          { userId: ownerUser, partnerRole: "partner_owner" },
          partnerId,
          ownerUser,
          { status: "inactive" },
        ),
      ),
    ).rejects.toSatisfy(isAppError("invalid_input"));

    const members = await inPartner(financeUser, (tx) =>
      listPartnerMembers(tx, partnerId),
    );
    expect(members.map((m) => [m.email, m.role]).sort()).toEqual([
      ["dono@agencia-teste.com.br", "partner_owner"],
      ["financeiro@agencia-teste.com.br", "partner_support"],
    ]);
  });

  it("shows only the partner's companies and lets the owner edit the brand", async () => {
    await admin.$executeRawUnsafe(
      `update public.organizations set partner_id = '${partnerId}' where id = '${orgB}'`,
    );
    const customers = await withIdentityContext(
      prisma,
      ownerUser,
      (tx) => listPartnerCustomers(tx, partnerId),
      { partnerId },
    );
    expect(customers.map((c) => c.id)).toEqual([orgB]);

    await withIdentityContext(
      prisma,
      ownerUser,
      (tx) =>
        saveBrandVersion(
          tx,
          { userId: ownerUser, partnerRole: "partner_owner" },
          partnerId,
          { displayName: "Agência Teste Marca", primaryColor: "#6a1b9a" },
          { kind: "keep" },
        ),
      { partnerId },
    );
    expect((await loadActiveBrand(prisma, partnerId)).name).toBe(
      "Agência Teste Marca",
    );
    await expect(
      withIdentityContext(
        prisma,
        financeUser,
        (tx) =>
          saveBrandVersion(
            tx,
            { userId: financeUser, partnerRole: "partner_support" },
            partnerId,
            { displayName: "Não" },
            { kind: "keep" },
          ),
        { partnerId },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("suspending the partner removes console access and domain resolution", async () => {
    await withIdentityContext(prisma, platformOwner, (tx) =>
      setPartnerStatus(tx, platformActor, partnerId, "suspended"),
    );
    expect(await getPartnerMembership(prisma, ownerUser, partnerId)).toBeNull();
    expect(
      await resolvePartnerForHost(prisma, "app.agencia-teste.localhost"),
    ).toBeNull();
  });
});
