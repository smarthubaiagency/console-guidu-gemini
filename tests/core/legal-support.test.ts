import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveWorkspaceContext } from "@/core/auth/context";
import {
  acceptPendingLegalDocuments,
  pendingLegalDocuments,
  publishLegalDocument,
} from "@/core/legal/service";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import {
  decideSupportGrant,
  listPartnerSupportGrants,
  listWorkspaceSupportGrants,
  requestSupportAccess,
  revokeSupportGrant,
} from "@/core/partners/support";
import { Permissions } from "@/core/permissions/catalog";
import {
  PermissionDeniedError,
  getEffectiveWorkspaceRole,
  requireWorkspacePermission,
} from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const platformOwner = "d0000000-0000-4000-8000-000000000003";
const supportUser = "d0000000-0000-4000-8000-000000000004";
const partnerId = "b0000000-0000-4000-8000-0000000000d2";

const isAppError = (code: string) => (e: unknown) =>
  e instanceof AppError && e.code === code;

describeDatabase(
  "P4b2: legal documents and support access (ADR 0012)",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '${HOUSE_PARTNER_ID}' where partner_id = '${partnerId}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.partners where id = '${partnerId}'`,
      );
    }

    beforeAll(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("asks for acceptance of new versions only when they require it", async () => {
      const publish = (requiresAcceptance: boolean) =>
        withIdentityContext(
          prisma,
          platformOwner,
          (tx) =>
            publishLegalDocument(
              tx,
              { userId: platformOwner, platformRole: "owner" },
              HOUSE_PARTNER_ID,
              {
                kind: "terms",
                title: "Termos",
                body: "Texto",
                requiresAcceptance,
              },
            ),
          { partnerId: HOUSE_PARTNER_ID },
        );
      const pending = () =>
        withIdentityContext(
          prisma,
          ids.userA,
          (tx) => pendingLegalDocuments(tx, HOUSE_PARTNER_ID, ids.userA),
          { partnerId: HOUSE_PARTNER_ID },
        );

      await expect(
        withIdentityContext(
          prisma,
          ids.userA,
          (tx) =>
            publishLegalDocument(
              tx,
              { userId: ids.userA, platformRole: null },
              HOUSE_PARTNER_ID,
              {
                kind: "terms",
                title: "X",
                body: "X",
                requiresAcceptance: true,
              },
            ),
          { partnerId: HOUSE_PARTNER_ID },
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const first = await publish(false); // first version always requires it
      expect((await pending()).map((d) => d.version)).toEqual([first.version]);

      await withIdentityContext(
        prisma,
        ids.userA,
        (tx) => acceptPendingLegalDocuments(tx, HOUSE_PARTNER_ID, ids.userA),
        { partnerId: HOUSE_PARTNER_ID },
      );
      expect(await pending()).toEqual([]);

      await publish(false); // editorial change: previous acceptance holds
      expect(await pending()).toEqual([]);

      const relevant = await publish(true);
      expect((await pending()).map((d) => d.version)).toEqual([
        relevant.version,
      ]);

      await admin.$executeRawUnsafe("delete from public.legal_acceptances");
      await admin.$executeRawUnsafe(
        "delete from public.partner_legal_documents",
      );
    });

    it("gives approved support access as viewer until it is revoked", async () => {
      await admin.$executeRawUnsafe(
        `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-p4b2', 'Agência P4b2')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.partner_members (partner_id, user_id, email, role) values ('${partnerId}', '${supportUser}', 'suporte@p4b2.test', 'partner_support')`,
      );
      await admin.$executeRawUnsafe(
        `update public.organizations set partner_id = '${partnerId}' where id = '${ids.organizationB}'`,
      );
      const inPartner = <T>(fn: Parameters<typeof withIdentityContext<T>>[2]) =>
        withIdentityContext(prisma, supportUser, fn, { partnerId });
      const actor = {
        userId: supportUser,
        partnerRole: "partner_support" as const,
      };
      const request = () =>
        inPartner((tx) =>
          requestSupportAccess(tx, actor, partnerId, {
            organizationId: ids.organizationB,
            reason: "Investigar erro de configuração",
            durationHours: 2,
          }),
        );

      const { id: grantId } = await request();
      await expect(request()).rejects.toSatisfy(isAppError("conflict"));

      // Before approval the grantee has no access.
      await expect(
        resolveWorkspaceContext(prisma, supportUser, "workspace-b", partnerId),
      ).rejects.toThrow("Workspace not found or inactive");

      const ownerCtx = await resolveWorkspaceContext(
        prisma,
        ids.userB,
        "workspace-b",
        partnerId,
      );
      const visible = await withContext(prisma, ownerCtx, (tx) =>
        listWorkspaceSupportGrants(tx, ownerCtx),
      );
      expect(visible.map((g) => [g.id, g.status])).toEqual([
        [grantId, "pending"],
      ]);
      await withContext(prisma, ownerCtx, (tx) =>
        decideSupportGrant(tx, ownerCtx, grantId, "approve"),
      );

      const supportCtx = await resolveWorkspaceContext(
        prisma,
        supportUser,
        "workspace-b",
        partnerId,
      );
      await withContext(prisma, supportCtx, async (tx) => {
        expect(await getEffectiveWorkspaceRole(tx, supportCtx)).toBe("viewer");
        await expect(
          requireWorkspacePermission(
            tx,
            supportCtx,
            Permissions.WORKSPACE_READ,
          ),
        ).resolves.toMatchObject({ workspaceRole: "viewer" });
      });
      await expect(
        withContext(prisma, supportCtx, (tx) =>
          requireWorkspacePermission(
            tx,
            supportCtx,
            Permissions.WORKSPACE_MEMBERS_MANAGE,
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      const partnerView = await inPartner((tx) =>
        listPartnerSupportGrants(tx, partnerId),
      );
      expect(partnerView[0]).toMatchObject({
        status: "approved",
        active: true,
        workspaceSlug: "workspace-b",
      });

      await withContext(prisma, ownerCtx, (tx) =>
        revokeSupportGrant(tx, ownerCtx, grantId),
      );
      await expect(
        resolveWorkspaceContext(prisma, supportUser, "workspace-b", partnerId),
      ).rejects.toThrow("Workspace not found or inactive");
    });

    it("expires support access without any job", async () => {
      const { id: grantId } = await withIdentityContext(
        prisma,
        supportUser,
        (tx) =>
          requestSupportAccess(
            tx,
            { userId: supportUser, partnerRole: "partner_support" },
            partnerId,
            {
              organizationId: ids.organizationB,
              reason: "Segundo pedido de suporte",
              durationHours: 1,
            },
          ),
        { partnerId },
      );
      const ownerCtx = await resolveWorkspaceContext(
        prisma,
        ids.userB,
        "workspace-b",
        partnerId,
      );
      await withContext(prisma, ownerCtx, (tx) =>
        decideSupportGrant(tx, ownerCtx, grantId, "approve"),
      );
      const supportCtx = await resolveWorkspaceContext(
        prisma,
        supportUser,
        "workspace-b",
        partnerId,
      );

      await admin.$executeRawUnsafe(
        `update public.partner_support_grants set expires_at = now() - interval '1 minute' where id = '${grantId}'`,
      );
      await expect(
        resolveWorkspaceContext(prisma, supportUser, "workspace-b", partnerId),
      ).rejects.toThrow("Workspace not found or inactive");
      // A context built before expiry no longer grants a role either.
      await withContext(prisma, supportCtx, async (tx) => {
        expect(await getEffectiveWorkspaceRole(tx, supportCtx)).toBeNull();
      });
    });
  },
);
