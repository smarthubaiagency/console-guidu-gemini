import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveWorkspaceContext } from "@/core/auth/context";
import type { Identity } from "@/core/auth/identity";
import { acceptInvitation } from "@/core/organizations/invitations";
import {
  createPartnerCustomer,
  createWorkspaceTemplate,
  listOfferedModuleKeys,
  setModuleOffered,
} from "@/core/partners/customers";
import { listPartnerCustomers } from "@/core/partners/members";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

/** Fixtures (tests/core/membership-seed.sql): users without memberships. */
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const partnerFinance = "d0000000-0000-4000-8000-000000000005";
const customerOwner = "d0000000-0000-4000-8000-000000000007";
const partnerId = "b0000000-0000-4000-8000-0000000000c1";
// Unique per run: audited companies are never deleted, only detached.
const slug = `cliente-p4b-${Date.now().toString(36)}`;

function identity(userId: string, email: string): Identity {
  return {
    userId,
    email,
    emailConfirmedAt: new Date().toISOString(),
    mfaSatisfied: true,
    profile: { id: userId } as Identity["profile"],
  };
}

const isAppError = (code: string) => (e: unknown) =>
  e instanceof AppError && e.code === code;

describeDatabase(
  "P4b: customers registered by the partner (ADR 0012)",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    const owner = {
      userId: partnerOwner,
      partnerRole: "partner_owner" as const,
    };
    const inPartner = <T>(
      userId: string,
      fn: Parameters<typeof withIdentityContext<T>>[2],
    ) => withIdentityContext(prisma, userId, fn, { partnerId });

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '00000000-0000-4000-8000-000000000000' where partner_id = '${partnerId}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.partners where id = '${partnerId}'`,
      );
    }

    beforeAll(async () => {
      vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "true");
      await cleanup();
      await admin.$executeRawUnsafe(
        `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-p4b', 'Agência P4b')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerId}', '${partnerOwner}', 'dono@p4b.test', 'partner_owner'),
        ('${partnerId}', '${partnerFinance}', 'fin@p4b.test', 'partner_finance')`,
      );
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("builds the catalog and templates only from offered modules", async () => {
      await expect(
        inPartner(partnerOwner, (tx) =>
          setModuleOffered(tx, owner, partnerId, "nao-existe", true),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
      await expect(
        inPartner(partnerOwner, (tx) =>
          setModuleOffered(tx, owner, partnerId, "catalog", true),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input")); // "coming soon"

      await inPartner(partnerOwner, (tx) =>
        setModuleOffered(tx, owner, partnerId, "hello-world", true),
      );
      expect(
        await inPartner(partnerFinance, (tx) =>
          listOfferedModuleKeys(tx, partnerId),
        ),
      ).toEqual(["hello-world"]);

      await expect(
        inPartner(partnerFinance, (tx) =>
          createWorkspaceTemplate(
            tx,
            { userId: partnerFinance, partnerRole: "partner_finance" },
            partnerId,
            { name: "X", moduleKeys: [] },
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        inPartner(partnerOwner, (tx) =>
          createWorkspaceTemplate(tx, owner, partnerId, {
            name: "Errado",
            moduleKeys: ["catalog"],
          }),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
    });

    it("registers a customer whose owner accepts on the partner and gets the template modules", async () => {
      const { id: templateId } = await inPartner(partnerOwner, (tx) =>
        createWorkspaceTemplate(tx, owner, partnerId, {
          name: "Padrão",
          moduleKeys: ["hello-world"],
        }),
      );

      const created = await inPartner(partnerOwner, (tx) =>
        createPartnerCustomer(
          tx,
          owner,
          partnerId,
          {
            organizationName: "Cliente P4b",
            workspaceName: "Principal",
            workspaceSlug: slug,
            ownerEmail: "Responsavel@Cliente.test",
            templateId,
          },
          "http://agencia-p4b.localhost:3000",
        ),
      );
      expect(created.inviteUrl).toMatch(
        /^http:\/\/agencia-p4b\.localhost:3000\/invite\/[0-9a-f]{64}$/,
      );

      // Same slug again: conflict, nothing half-created.
      await expect(
        inPartner(partnerOwner, (tx) =>
          createPartnerCustomer(
            tx,
            owner,
            partnerId,
            {
              organizationName: "Outro",
              workspaceName: "Outro",
              workspaceSlug: slug,
              ownerEmail: "x@cliente.test",
            },
            "http://x",
          ),
        ),
      ).rejects.toSatisfy(isAppError("conflict"));
      const customers = await inPartner(partnerFinance, (tx) =>
        listPartnerCustomers(tx, partnerId),
      );
      expect(customers.map((c) => c.name)).toEqual(["Cliente P4b"]);

      // The partner itself cannot open the customer workspace.
      await expect(
        resolveWorkspaceContext(prisma, partnerOwner, slug, partnerId),
      ).rejects.toThrow("Workspace not found or inactive");

      // The responsible person accepts and owns company and workspace.
      const rawToken = created.inviteUrl.split("/").pop()!;
      await acceptInvitation(prisma, {
        rawToken,
        identity: identity(customerOwner, "responsavel@cliente.test"),
      });
      const context = await resolveWorkspaceContext(
        prisma,
        customerOwner,
        slug,
        partnerId,
      );
      expect(context.organizationId).toBe(created.organizationId);
      await expect(
        resolveWorkspaceContext(
          prisma,
          customerOwner,
          slug,
          "00000000-0000-4000-8000-000000000000",
        ),
      ).rejects.toThrow("Workspace not found or inactive");

      const modules = await withContext(prisma, context, (tx) =>
        tx.workspaceModule.findMany({
          select: { moduleKey: true, status: true },
        }),
      );
      expect(modules).toEqual([
        { moduleKey: "hello-world", status: "enabled" },
      ]);
      const roles = await withContext(prisma, context, (tx) =>
        tx.workspaceMember.findMany({
          where: { userId: customerOwner },
          select: { role: true },
        }),
      );
      expect(roles).toEqual([{ role: "owner" }]);
    });

    it("refuses customer registration to partner_finance", async () => {
      await expect(
        inPartner(partnerFinance, (tx) =>
          createPartnerCustomer(
            tx,
            { userId: partnerFinance, partnerRole: "partner_finance" },
            partnerId,
            {
              organizationName: "X",
              workspaceName: "X",
              workspaceSlug: `${slug}-x`,
              ownerEmail: "x@cliente.test",
            },
            "http://x",
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  },
);
