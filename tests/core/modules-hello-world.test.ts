import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPlatformAdminMember } from "@/core/admin/platform";
import {
  savePlatformModuleConfig,
  saveWorkspaceModuleConfig,
  setPlatformModuleAvailability,
  setWorkspaceModuleStatus,
} from "@/core/module-runtime/settings";
import { getModuleAccessState } from "@/core/module-runtime/state";
import { ModuleUnavailableError } from "@/core/modules/availability";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { HELLO_WORLD_DEMO_RECORD_LIMIT } from "@/modules/hello-world/manifest";
import {
  createHelloWorldRecord,
  getHelloWorldRecord,
  listHelloWorldRecords,
  resolveHelloWorldGreeting,
} from "@/modules/hello-world/server";
import { AppError } from "@/shared/errors";

import { contextA, contextB, contextMultiOrgInA } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

/** Active platform owner from tests/core/admin-seed.sql. */
const platformOwnerId = "d0000000-0000-4000-8000-000000000003";
/** Viewer of workspace A (fixtures: multi-organization user). */
const viewerInA = contextMultiOrgInA;

function expectAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

describeDatabase(
  "F2: module contract and hello-world reference module (ADRs 0005/0006, Adendo §9)",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });

    // Migration administrator, one statement per call (prepared statements).
    async function resetDemoState(): Promise<void> {
      await admin.$executeRawUnsafe("delete from public.hello_world_records");
      await admin.$executeRawUnsafe("delete from public.workspace_modules");
      await admin.$executeRawUnsafe("delete from public.platform_modules");
    }

    beforeAll(async () => {
      vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "true");
      await resetDemoState();
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await resetDemoState();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("blocks module services while the workspace has not enabled it", async () => {
      await withContext(prisma, contextA, async (tx) => {
        expect(await getModuleAccessState(tx, contextA, "hello-world")).toBe(
          "not_enabled",
        );
      });
      await expect(
        withContext(prisma, contextA, (tx) =>
          createHelloWorldRecord(tx, contextA, { title: "x" }),
        ),
      ).rejects.toBeInstanceOf(ModuleUnavailableError);
      const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
        "select count(*) from public.hello_world_records",
      );
      expect(Number(count)).toBe(0);
    });

    it("lets only owner/admin enable the module and audits the change", async () => {
      await expect(
        withContext(prisma, viewerInA, (tx) =>
          setWorkspaceModuleStatus(tx, viewerInA, "hello-world", "enabled"),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      await withContext(prisma, contextA, (tx) =>
        setWorkspaceModuleStatus(tx, contextA, "hello-world", "enabled"),
      );
      await withContext(prisma, contextA, async (tx) => {
        expect(await getModuleAccessState(tx, contextA, "hello-world")).toBe(
          "enabled",
        );
      });
      const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
        "select count(*) from public.audit_events where action = 'workspace.module.enable' and resource_id = 'hello-world'",
      );
      expect(Number(count)).toBeGreaterThan(0);
    });

    it("refuses to enable a coming-soon module", async () => {
      await expect(
        withContext(prisma, contextA, (tx) =>
          setWorkspaceModuleStatus(tx, contextA, "catalog", "enabled"),
        ),
      ).rejects.toSatisfy(expectAppError("conflict"));
    });

    it("creates, lists and reads records with permission and workspace isolation", async () => {
      const created = await withContext(prisma, contextA, (tx) =>
        createHelloWorldRecord(tx, contextA, { title: "Primeiro registro" }),
      );
      expect(created.createdByMe).toBe(true);

      const viewerList = await withContext(prisma, viewerInA, (tx) =>
        listHelloWorldRecords(tx, viewerInA),
      );
      expect(viewerList.records.map((r) => r.id)).toEqual([created.id]);

      await expect(
        withContext(prisma, viewerInA, (tx) =>
          createHelloWorldRecord(tx, viewerInA, { title: "Não" }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      // Workspace B: module disabled there, then enabled but sees nothing from A.
      await expect(
        withContext(prisma, contextB, (tx) =>
          listHelloWorldRecords(tx, contextB),
        ),
      ).rejects.toBeInstanceOf(ModuleUnavailableError);
      await withContext(prisma, contextB, (tx) =>
        setWorkspaceModuleStatus(tx, contextB, "hello-world", "enabled"),
      );
      const listB = await withContext(prisma, contextB, (tx) =>
        listHelloWorldRecords(tx, contextB),
      );
      expect(listB.records).toEqual([]);
      await expect(
        withContext(prisma, contextB, (tx) =>
          getHelloWorldRecord(tx, contextB, created.id),
        ),
      ).rejects.toSatisfy(expectAppError("not_found"));
    });

    it("rejects invalid input and enforces the demonstration limit", async () => {
      await expect(
        withContext(prisma, contextA, (tx) =>
          createHelloWorldRecord(tx, contextA, { title: "  " }),
        ),
      ).rejects.toSatisfy(expectAppError("invalid_input"));

      const current = await withContext(prisma, contextA, (tx) =>
        listHelloWorldRecords(tx, contextA),
      );
      for (
        let i = current.records.length;
        i < HELLO_WORLD_DEMO_RECORD_LIMIT;
        i += 1
      ) {
        await withContext(prisma, contextA, (tx) =>
          createHelloWorldRecord(tx, contextA, { title: `Registro ${i + 1}` }),
        );
      }
      await expect(
        withContext(prisma, contextA, (tx) =>
          createHelloWorldRecord(tx, contextA, { title: "Excedente" }),
        ),
      ).rejects.toSatisfy(expectAppError("conflict"));
    });

    it("saves workspace settings with write permission and schema validation", async () => {
      await expect(
        withContext(prisma, viewerInA, (tx) =>
          saveWorkspaceModuleConfig(tx, viewerInA, "hello-world", {
            greeting: "Oi",
          }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        withContext(prisma, contextA, (tx) =>
          saveWorkspaceModuleConfig(tx, contextA, "hello-world", {
            greeting: "x".repeat(81),
          }),
        ),
      ).rejects.toSatisfy(expectAppError("invalid_input"));

      await withContext(prisma, contextA, (tx) =>
        saveWorkspaceModuleConfig(tx, contextA, "hello-world", {
          greeting: "Olá, Workspace A!",
        }),
      );
      const greeting = await withContext(prisma, viewerInA, (tx) =>
        resolveHelloWorldGreeting(tx, viewerInA),
      );
      expect(greeting).toEqual({
        greeting: "Olá, Workspace A!",
        origin: "workspace",
      });
    });

    it("applies global settings and availability only for platform owner/operations", async () => {
      const owner = await getPlatformAdminMember(prisma, platformOwnerId);
      expect(owner?.role).toBe("owner");

      await expect(
        withIdentityContext(prisma, contextA.userId, (tx) =>
          setPlatformModuleAvailability(
            tx,
            contextA.userId,
            null,
            "hello-world",
            "maintenance",
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      await withIdentityContext(prisma, platformOwnerId, (tx) =>
        savePlatformModuleConfig(
          tx,
          platformOwnerId,
          owner?.role ?? null,
          "hello-world",
          {
            defaultGreeting: "Olá da plataforma",
          },
        ),
      );
      const inherited = await withContext(prisma, contextB, (tx) =>
        resolveHelloWorldGreeting(tx, contextB),
      );
      expect(inherited).toEqual({
        greeting: "Olá da plataforma",
        origin: "global",
      });

      await withIdentityContext(prisma, platformOwnerId, (tx) =>
        setPlatformModuleAvailability(
          tx,
          platformOwnerId,
          owner?.role ?? null,
          "hello-world",
          "maintenance",
        ),
      );
      await expect(
        withContext(prisma, contextA, (tx) =>
          listHelloWorldRecords(tx, contextA),
        ),
      ).rejects.toBeInstanceOf(ModuleUnavailableError);

      await withIdentityContext(prisma, platformOwnerId, (tx) =>
        setPlatformModuleAvailability(
          tx,
          platformOwnerId,
          owner?.role ?? null,
          "hello-world",
          "enabled",
        ),
      );
      const list = await withContext(prisma, contextA, (tx) =>
        listHelloWorldRecords(tx, contextA),
      );
      expect(list.records.length).toBe(HELLO_WORLD_DEMO_RECORD_LIMIT);
    });
  },
);
