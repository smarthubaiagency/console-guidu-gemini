import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPlatformAdminMember } from "@/core/admin/platform";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { listSecurityEvents, parseBefore } from "@/core/security/events";
import { isAreaIpAllowed } from "@/core/security/ip-gate";
import {
  allowlistView,
  type AllowlistActor,
  saveAllowlist,
} from "@/core/security/ip-allowlist";
import { workspaceRequiresMfa } from "@/core/security/workspace-mfa";
import { saveSettings, type SettingsActor } from "@/core/settings/service";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF5a: Configurações › Segurança. The MFA requirement of the workspaces
 * only tightens down the cascade, the IP allow lists never lock the saver
 * out, and the security events are read by the platform and, for theirs,
 * by the partner managers.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "bcf50000-0000-4000-8000-000000000001";
const HOUSE = "00000000-0000-4000-8000-000000000000";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";

describeDatabase("CF5a: security settings", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const startedAt = new Date();

  const platformList: AllowlistActor = {
    area: "platform",
    userId: PLATFORM_OWNER,
    platformRole: "owner",
  };
  const partnerList: AllowlistActor = {
    area: "admin",
    userId: ids.userA,
    partnerId: PARTNER,
    partnerRole: "partner_owner",
  };
  const partnerSettings: SettingsActor = {
    level: "partner",
    userId: ids.userA,
    partnerId: PARTNER,
    partnerRole: "partner_owner",
  };
  const workspaceOwner: RequestContext = { ...contextB, principalType: "user" };

  const inPlatform = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, PLATFORM_OWNER, op);
  const inPartner = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, ids.userA, op, { partnerId: PARTNER });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.ip_allowlists where area = 'platform' or partner_id = '${PARTNER}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.settings where key like 'security.%'`,
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
       values ('${PARTNER}', 'agencia-cf5', 'Agência CF5')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${PARTNER}', '${ids.userA}', 'owner@cf5.test', 'partner_owner')`,
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

  describe("MFA required in the workspaces", () => {
    it("is off by default and on once the partner requires it", async () => {
      expect(await workspaceRequiresMfa(prisma, workspaceOwner)).toBe(false);
      await inPartner((tx) =>
        saveSettings(tx, partnerSettings, {
          values: { "security.mfa.app": true },
          locks: { "security.mfa.app": false },
        }),
      );
      expect(await workspaceRequiresMfa(prisma, workspaceOwner)).toBe(true);
    });

    it("never lets the workspace turn the partner's requirement off", async () => {
      await expect(
        withContext(prisma, workspaceOwner, (tx) =>
          saveSettings(
            tx,
            { level: "workspace", userId: ids.userB, ctx: workspaceOwner },
            { values: { "security.mfa.app": false } },
          ),
        ),
      ).rejects.toMatchObject({ messageKey: "settings.errors.locked" });

      // Back to optional: the workspace may then require it for itself.
      await inPartner((tx) =>
        saveSettings(tx, partnerSettings, {
          values: { "security.mfa.app": null },
        }),
      );
      expect(await workspaceRequiresMfa(prisma, workspaceOwner)).toBe(false);
      await withContext(prisma, workspaceOwner, (tx) =>
        saveSettings(
          tx,
          { level: "workspace", userId: ids.userB, ctx: workspaceOwner },
          { values: { "security.mfa.app": true } },
        ),
      );
      expect(await workspaceRequiresMfa(prisma, workspaceOwner)).toBe(true);
    });
  });

  describe("IP allow lists", () => {
    it("refuses a list without the saver's address, or invalid", async () => {
      await expect(
        inPlatform((tx) =>
          saveAllowlist(tx, platformList, "198.51.100.0/24", "203.0.113.7"),
        ),
      ).rejects.toMatchObject({ messageKey: "security.errors.selfExcluded" });
      await expect(
        inPlatform((tx) =>
          saveAllowlist(tx, platformList, "203.0.113.7 nope", "203.0.113.7"),
        ),
      ).rejects.toMatchObject({ messageKey: "security.errors.invalidEntries" });
      await expect(
        inPlatform((tx) =>
          saveAllowlist(tx, platformList, "203.0.113.7", null),
        ),
      ).rejects.toMatchObject({ messageKey: "security.errors.ipUnknown" });
    });

    it("saves a normalized list that includes the saver, and audits it", async () => {
      const view = await inPlatform((tx) =>
        saveAllowlist(
          tx,
          platformList,
          "203.0.113.9/24\n2001:db8::/32\n203.0.113.0/24",
          "203.0.113.7",
        ),
      );
      expect(view.entries).toEqual(["203.0.113.0/24", "2001:db8::/32"]);
      const audit = await admin.$queryRawUnsafe<{ count: bigint }[]>(
        `select count(*) as count from public.audit_events
         where action = 'platform.security.ip_allowlist.save'
           and actor_user_id = '${PLATFORM_OWNER}'
           and metadata ->> 'status' = 'on' and (metadata ->> 'count')::int = 2`,
      );
      expect(Number(audit[0]?.count)).toBeGreaterThan(0);

      // Outside a request there is no address and no check.
      expect(await isAreaIpAllowed(prisma, "platform", null)).toBe(true);
      expect(
        await getPlatformAdminMember(prisma, PLATFORM_OWNER),
      ).not.toBeNull();

      // An empty list turns the restriction off.
      const off = await inPlatform((tx) =>
        saveAllowlist(tx, platformList, "  ", "198.51.100.1"),
      );
      expect(off.entries).toEqual([]);
    });

    it("keeps the partner's list to its managers", async () => {
      const view = await inPartner((tx) =>
        saveAllowlist(tx, partnerList, "::1", "::1"),
      );
      expect(view.entries).toEqual(["::1/128"]);

      const support: AllowlistActor = {
        ...partnerList,
        partnerRole: "partner_support",
      };
      await expect(
        inPartner((tx) => saveAllowlist(tx, support, "", "::1")),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      const hidden = await inPartner((tx) => allowlistView(tx, support, "::1"));
      expect(hidden).toMatchObject({ canEdit: false, entries: [] });

      // The platform does not see the partner's list.
      const fromPlatform = await inPlatform((tx) =>
        allowlistView(tx, platformList, null),
      );
      expect(fromPlatform.entries).toEqual([]);
    });
  });

  describe("security events", () => {
    it("shows the platform every security event and the partner its own", async () => {
      const platform = await inPlatform((tx) =>
        listSecurityEvents(tx, { limit: 200 }),
      );
      const recent = platform.events.filter((e) => e.occurredAt >= startedAt);
      const actions = recent.map((e) => e.action);
      expect(actions).toContain("platform.security.ip_allowlist.save");
      expect(actions).toContain("partner.security.ip_allowlist.save");
      expect(actions).toContain("partner.settings.save");
      // Partner owners get their e-mail.
      expect(
        recent.find((e) => e.action === "partner.security.ip_allowlist.save")
          ?.actorEmail,
      ).toBe("owner@cf5.test");

      const partner = await inPartner((tx) =>
        listSecurityEvents(tx, { limit: 200 }),
      );
      const partnerActions = partner.events.map((e) => e.action);
      expect(partnerActions).toContain("partner.security.ip_allowlist.save");
      // Workspace B belongs to the partner's customer.
      expect(partnerActions).toContain("workspace.settings.save");
      expect(partnerActions).not.toContain(
        "platform.security.ip_allowlist.save",
      );
    });

    it("pages from the newest to the oldest", async () => {
      const first = await inPlatform((tx) =>
        listSecurityEvents(tx, { limit: 1 }),
      );
      expect(first.events).toHaveLength(1);
      expect(first.nextBefore).not.toBeNull();
      const second = await inPlatform((tx) =>
        listSecurityEvents(tx, {
          limit: 1,
          before: parseBefore(first.nextBefore!),
        }),
      );
      expect(second.events[0]?.id).not.toBe(first.events[0]?.id);
    });

    it("never skips events of the same millisecond (AJ1)", async () => {
      // Three sign-ins in one millisecond, two of them at the same instant.
      const at = "2026-10-02 09:00:00.123";
      const sameIds = [
        "c5aa0000-0000-4000-8000-000000000001",
        "c5aa0000-0000-4000-8000-000000000002",
        "c5aa0000-0000-4000-8000-000000000003",
      ];
      await admin.$executeRawUnsafe(
        `insert into public.audit_events
           (id, actor_user_id, actor_principal_type, origin, action, resource_type, result, metadata, occurred_at)
         values ($1::uuid, $4::uuid, 'user', 'app', 'auth.sign_in', 'session', 'success', '{}', '${at}456+00'),
                ($2::uuid, $4::uuid, 'user', 'app', 'auth.sign_in', 'session', 'success', '{}', '${at}456+00'),
                ($3::uuid, $4::uuid, 'user', 'app', 'auth.sign_in', 'session', 'success', '{}', '${at}789+00')
         on conflict (id) do nothing`,
        ...sameIds,
        PLATFORM_OWNER,
      );
      const seen: string[] = [];
      let before = parseBefore(
        "2026-10-02T09:00:01.000000Z_ffffffff-ffff-4fff-bfff-ffffffffffff",
      );
      for (let i = 0; i < 3; i += 1) {
        const page = await inPlatform((tx) =>
          listSecurityEvents(tx, { limit: 1, before }),
        );
        seen.push(page.events[0]!.id);
        if (i < 2) {
          expect(page.nextBefore).toMatch(/^2026-10-02T09:00:00\.123\d{3}Z_/);
          before = parseBefore(page.nextBefore!);
        }
      }
      expect(seen).toEqual([sameIds[2], sameIds[1], sameIds[0]]);
    });
  });
});
