import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The registry of the contract, with one background analysis of test so
// the phases are covered whatever the GB1b delivers.
vi.mock("@/modules/google-business/analyses/registry", async () => {
  const { deterministicAnalyses } =
    await import("@/modules/google-business/analyses/deterministic");
  return {
    locationAnalyses: [
      ...deterministicAnalyses,
      {
        key: "test-background",
        area: "maps",
        phase: "background",
        labelKey: "googleBusiness.analyses.unknown",
        usesAi: false,
        async run() {
          return {
            status: "done",
            findings: [
              {
                key: "test-finding",
                area: "maps",
                severity: "low",
                titleKey: "googleBusiness.findings.generic.title",
                detailKey: "googleBusiness.findings.generic.title",
                source: "maps",
              },
            ],
            metrics: { score: 42 },
          };
        },
      },
    ],
  };
});

import { createPartnerCustomer } from "@/core/partners/customers";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { createFakeGoogleBusinessProvider } from "@/modules/google-business/provider/fake";
import { AUTOMATION_AREAS } from "@/modules/google-business/areas";
import { managerKind } from "@/modules/google-business/server/access";
import {
  listLocations,
  loadAutomation,
  saveArea,
} from "@/modules/google-business/server/automation";
import { runBackgroundAnalyses } from "@/modules/google-business/server/background";
import { backgroundAnalysesJob } from "@/modules/google-business/server/jobs";
import {
  attachUnit,
  blockingSteps,
  finishOnboarding,
  prepareLocation,
  runBlockingAnalysis,
} from "@/modules/google-business/server/onboarding";
import type { Db } from "@/modules/google-business/server/runner";
import { AppError } from "@/shared/errors";

import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const HOUSE = "00000000-0000-4000-8000-000000000000";
const ownerN = "d0000000-0000-4000-8000-000000000001";
const viewerN = "d0000000-0000-4000-8000-000000000002";
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const customerOwnerM = "d0000000-0000-4000-8000-000000000010";
const PENDING = "fake:manage_profile,account_identity";

const isAppError = (code: string) => (e: unknown) =>
  e instanceof AppError && e.code === code;

describeDatabase(
  "GB1a: onboarding Adicionar local and the automation page",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    const provider = createFakeGoogleBusinessProvider("http://localhost");
    // Unique per run: audited companies are never deleted.
    const run = Date.now().toString(36);
    const partnerId = randomUUID();
    const orgN = randomUUID();
    const wsN = randomUUID();
    const orgM = randomUUID();
    const wsM = randomUUID();
    const orgS = randomUUID();
    const wsS = randomUUID();

    const ownerCtx: RequestContext = {
      userId: ownerN,
      workspaceId: wsN,
      organizationId: orgN,
      partnerId: HOUSE,
    };
    const viewerCtx: RequestContext = { ...ownerCtx, userId: viewerN };
    const partnerCtxM: RequestContext = {
      userId: partnerOwner,
      workspaceId: wsM,
      organizationId: orgM,
      partnerId,
    };
    const partnerCtxS: RequestContext = {
      ...partnerCtxM,
      workspaceId: wsS,
      organizationId: orgS,
    };
    const customerCtxM: RequestContext = {
      userId: customerOwnerM,
      workspaceId: wsM,
      organizationId: orgM,
      partnerId,
    };
    const db =
      (ctx: RequestContext): Db =>
      (operation) =>
        withContext(prisma, ctx, operation);

    async function onboard(ctx: RequestContext, optionId: string) {
      const prepared = await prepareLocation(
        db(ctx),
        ctx,
        provider,
        PENDING,
        optionId,
      );
      return prepared;
    }

    beforeAll(async () => {
      vi.stubEnv("GUIDU_MODULE_GOOGLE_BUSINESS_ENABLED", "true");
      const sql = (q: string) => admin.$executeRawUnsafe(q);
      await sql(
        `insert into public.partners (id, slug, name) values ('${partnerId}', 'gb1a-${run}', 'Agência GB1a')`,
      );
      await sql(
        `insert into public.partner_members (partner_id, user_id, email, role) values ('${partnerId}', '${partnerOwner}', 'dono@gb1a.test', 'partner_owner')`,
      );
      await sql(`insert into public.organizations (id, name, status, partner_id) values
        ('${orgN}', 'Padaria ${run}', 'active', '${HOUSE}'),
        ('${orgM}', 'Gerenciada ${run}', 'active', '${partnerId}'),
        ('${orgS}', 'Padrão ${run}', 'active', '${partnerId}')`);
      await sql(`insert into public.workspaces (id, organization_id, slug, name, status) values
        ('${wsN}', '${orgN}', 'gb1a-n-${run}', 'Padaria', 'active'),
        ('${wsM}', '${orgM}', 'gb1a-m-${run}', 'Gerenciada', 'active'),
        ('${wsS}', '${orgS}', 'gb1a-s-${run}', 'Padrão', 'active')`);
      await sql(`insert into public.workspace_members (workspace_id, organization_id, user_id, role, status) values
        ('${wsN}', '${orgN}', '${ownerN}', 'owner', 'active'),
        ('${wsN}', '${orgN}', '${viewerN}', 'viewer', 'active'),
        ('${wsM}', '${orgM}', '${customerOwnerM}', 'owner', 'active')`);
      await sql(`insert into public.organization_service_modes (organization_id, partner_id, mode) values
        ('${orgM}', '${partnerId}', 'gerenciado'),
        ('${orgS}', '${partnerId}', 'padrao')`);
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("reads the ficha, creates the unit from it and runs the blocking analyses step by step", async () => {
      const prepared = await onboard(ownerCtx, "fake-location-centro");
      expect(prepared.unitId).toBeNull();
      expect(prepared.matches).toEqual([]);

      const snapshot = await admin.gbSnapshot.findFirst({
        where: { gbLocationId: prepared.locationId },
      });
      expect(snapshot?.kind).toBe("initial");
      expect((snapshot?.reviews as unknown[]).length).toBe(6);
      const pending = await admin.gbAnalysisRun.findMany({
        where: { gbLocationId: prepared.locationId },
      });
      expect(pending.map((r) => r.status)).toEqual(
        pending.map(() => "pending"),
      );
      expect(pending.length).toBe(5);

      const attached = await withContext(prisma, ownerCtx, (tx) =>
        attachUnit(tx, ownerCtx, prepared.locationId, { create: true }),
      );
      expect(attached.created).toBe(true);
      const unit = await admin.workspaceLocation.findUnique({
        where: { id: attached.unitId },
      });
      expect(unit?.name).toBe("Padaria Pão Dourado — Centro");
      expect(unit?.address).toMatchObject({
        street_address: "Rua das Flores, 120",
        address_locality: "São Paulo",
        phone_number: "+551130000000",
      });
      expect((unit?.hours as unknown[]).length).toBe(6);

      const steps = blockingSteps();
      expect(steps.map((s) => s.key)).toEqual([
        "info-checklist",
        "hours-checklist",
        "photos-checklist",
        "reviews-summary",
      ]);
      for (const step of steps) {
        const result = await runBlockingAnalysis(
          db(ownerCtx),
          ownerCtx,
          prepared.locationId,
          step.key,
        );
        expect(result.status).toBe("done");
      }
      // A background analysis is not a step of the window.
      await expect(
        runBlockingAnalysis(
          db(ownerCtx),
          ownerCtx,
          prepared.locationId,
          "test-background",
        ),
      ).rejects.toSatisfy(isAppError("not_found"));

      const finished = await withContext(prisma, ownerCtx, (tx) =>
        finishOnboarding(
          tx,
          ownerCtx,
          prepared.locationId,
          "http://localhost/app/x/google-business",
        ),
      );
      expect(finished.background).toBe(1);
      expect(finished.points).toBeGreaterThan(3);
      const job = await admin.jobRun.findFirst({
        where: {
          workspaceId: wsN,
          kind: "google-business.background-analyses",
        },
      });
      expect(job?.status).toBe("pending");

      // The page shows the area "em andamento" until the job runs.
      const before = await withContext(prisma, ownerCtx, (tx) =>
        loadAutomation(tx, ownerCtx, prepared.locationId),
      );
      expect(before.runs.find((r) => r.key === "test-background")?.status).toBe(
        "pending",
      );
      expect(before.diagnosis.total).toBeGreaterThan(before.diagnosis.ok);
      expect(before.configured).toBe(0);

      // The job runs the background analysis and posts the bell notice.
      const jobRunId = randomUUID();
      await backgroundAnalysesJob.run(
        {
          jobRunId,
          transaction: (op: Parameters<Db>[0]) =>
            withContext(prisma, ownerCtx, op),
        } as never,
        ownerCtx,
        {
          locationId: prepared.locationId,
          linkUrl: "http://localhost/app/x/google-business",
        } as never,
      );
      const after = await withContext(prisma, ownerCtx, (tx) =>
        loadAutomation(tx, ownerCtx, prepared.locationId),
      );
      const background = after.runs.find((r) => r.key === "test-background");
      expect(background?.status).toBe("done");
      expect(background?.metrics.score).toBe(42);
      const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
        `select count(*) from public.user_notifications where user_id = '${ownerN}' and event_type = 'google_business.analyses_done' and idempotency_key like 'google-business.analyses:${prepared.locationId}:%'`,
      );
      expect(Number(count)).toBe(1);
      // Nothing left to run.
      expect(
        (
          await runBackgroundAnalyses(
            db(ownerCtx),
            ownerCtx,
            prepared.locationId,
            1000,
          )
        ).ran,
      ).toBe(0);
    });

    it("proposes the unit with the same address instead of duplicating it", async () => {
      const unit = await withContext(prisma, ownerCtx, (tx) =>
        tx.workspaceLocation.create({
          data: {
            organizationId: orgN,
            workspaceId: wsN,
            name: "Loja Campinas",
            address: {
              street_address: "Avenida Brasil, 500",
              address_locality: "Campinas",
            },
            createdBy: ownerN,
          },
        }),
      );
      const prepared = await onboard(ownerCtx, "fake-location-campinas");
      expect(prepared.matches.map((m) => m.id)).toEqual([unit.id]);
      const attached = await withContext(prisma, ownerCtx, (tx) =>
        attachUnit(tx, ownerCtx, prepared.locationId, { unitId: unit.id }),
      );
      expect(attached).toEqual({ unitId: unit.id, created: false });
      // The same ficha again is refused; the unit keeps one ficha.
      await expect(
        onboard(ownerCtx, "fake-location-campinas"),
      ).rejects.toSatisfy(isAppError("conflict"));
      const listed = await withContext(prisma, viewerCtx, (tx) =>
        listLocations(tx, viewerCtx),
      );
      expect(listed.map((l) => l.unitName).sort()).toEqual([
        "Loja Campinas",
        "Padaria Pão Dourado — Centro",
      ]);
    });

    it("lets only owner and admin operate; the viewer reads", async () => {
      await expect(
        onboard(viewerCtx, "fake-location-centro"),
      ).rejects.toSatisfy(isAppError("forbidden"));
      const [location] = await withContext(prisma, viewerCtx, (tx) =>
        listLocations(tx, viewerCtx),
      );
      const view = await withContext(prisma, viewerCtx, (tx) =>
        loadAutomation(tx, viewerCtx, location!.id),
      );
      expect(view.canManage).toBe(false);
      await expect(
        withContext(prisma, viewerCtx, (tx) =>
          saveArea(tx, viewerCtx, location!.id, {
            area: "reviews",
            enabled: true,
            autonomy: "auto",
            approve: true,
          }),
        ),
      ).rejects.toSatisfy(isAppError("forbidden"));
    });

    it("keeps the agent in suggest-only until every area is approved once", async () => {
      const [location] = (
        await withContext(prisma, ownerCtx, (tx) => listLocations(tx, ownerCtx))
      ).filter((l) => l.name.includes("Centro"));
      const id = location!.id;
      let result;
      for (const [index, area] of AUTOMATION_AREAS.entries()) {
        result = await withContext(prisma, ownerCtx, (tx) =>
          saveArea(tx, ownerCtx, id, {
            area,
            enabled: area !== "photos",
            autonomy: area === "reviews" ? "auto" : "approval",
            approve: true,
          }),
        );
        expect(result.configured).toBe(index + 1);
        if (index < AUTOMATION_AREAS.length - 1) {
          expect(result.reviewed).toBe(false);
          const view = await withContext(prisma, ownerCtx, (tx) =>
            loadAutomation(tx, ownerCtx, id),
          );
          expect(
            view.areas.find((a) => a.area === "reviews")?.effectiveAutonomy,
          ).toBe("suggest");
        }
      }
      expect(result?.reviewed).toBe(true);
      expect(result?.next).toBeNull();
      const view = await withContext(prisma, ownerCtx, (tx) =>
        loadAutomation(tx, ownerCtx, id),
      );
      expect(view.location.reviewed).toBe(true);
      const reviews = view.areas.find((a) => a.area === "reviews");
      expect(reviews).toMatchObject({
        autonomy: "auto",
        effectiveAutonomy: "auto",
        approved: true,
      });
      expect(view.areas.find((a) => a.area === "photos")).toMatchObject({
        enabled: false,
        effectiveAutonomy: "suggest",
      });
      const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
        `select count(*) from public.audit_events where action = 'google_business.location.review' and resource_id = '${id}'`,
      );
      expect(Number(count)).toBe(1);
    });

    it("never lets an area above the ceiling of the cascade", async () => {
      await admin.$executeRawUnsafe(
        `insert into public.settings (scope, partner_id, key, value, updated_by) values ('partner', '${partnerId}', 'google_business.autonomy_ceiling', '"approval"', '${partnerOwner}')`,
      );
      const prepared = await onboard(partnerCtxM, "fake-location-centro");
      await withContext(prisma, partnerCtxM, (tx) =>
        attachUnit(tx, partnerCtxM, prepared.locationId, { create: true }),
      );
      await expect(
        withContext(prisma, partnerCtxM, (tx) =>
          saveArea(tx, partnerCtxM, prepared.locationId, {
            area: "reviews",
            enabled: true,
            autonomy: "auto",
            approve: true,
          }),
        ),
      ).rejects.toSatisfy(isAppError("invalid_input"));
      const view = await withContext(prisma, partnerCtxM, (tx) =>
        loadAutomation(tx, partnerCtxM, prepared.locationId),
      );
      expect(view.ceiling).toBe("approval");
      expect(view.canManage).toBe(true);
    });

    it("opens the managed company to its partner and not the padrão one; the managed customer follows", async () => {
      expect(
        await withContext(prisma, partnerCtxM, (tx) =>
          managerKind(tx, partnerCtxM),
        ),
      ).toBe("partner");
      expect(
        await withContext(prisma, partnerCtxS, (tx) =>
          managerKind(tx, partnerCtxS),
        ),
      ).toBeNull();
      await expect(
        onboard(partnerCtxS, "fake-location-centro"),
      ).rejects.toSatisfy(isAppError("forbidden"));
      // The customer of a managed company reads but does not operate.
      expect(
        await withContext(prisma, customerCtxM, (tx) =>
          managerKind(tx, customerCtxM),
        ),
      ).toBeNull();
      const listed = await withContext(prisma, customerCtxM, (tx) =>
        listLocations(tx, customerCtxM),
      );
      expect(listed).toHaveLength(1);
      // The partner's work is audited in the customer's workspace.
      const [{ count }] = await admin.$queryRawUnsafe<[{ count: bigint }]>(
        `select count(*) from public.audit_events where action = 'google_business.location.connect' and workspace_id = '${wsM}' and actor_user_id = '${partnerOwner}'`,
      );
      expect(Number(count)).toBe(1);
    });

    it("records the service mode chosen when the partner registers a customer", async () => {
      const actor = {
        userId: partnerOwner,
        partnerRole: "partner_owner" as const,
      };
      const created = await withIdentityContext(
        prisma,
        partnerOwner,
        async (tx) => ({
          managed: await createPartnerCustomer(
            tx,
            actor,
            partnerId,
            {
              organizationName: `Nova ${run}`,
              workspaceName: "Nova",
              workspaceSlug: `gb1a-nova-${run}`,
              ownerEmail: "nova@gb1a.test",
            },
            "http://localhost",
          ),
          standard: await createPartnerCustomer(
            tx,
            actor,
            partnerId,
            {
              organizationName: `Sozinha ${run}`,
              workspaceName: "Sozinha",
              workspaceSlug: `gb1a-sozinha-${run}`,
              ownerEmail: "sozinha@gb1a.test",
              serviceMode: "padrao",
            },
            "http://localhost",
          ),
        }),
        { partnerId },
      );
      const modes = await admin.organizationServiceMode.findMany({
        where: {
          organizationId: {
            in: [
              created.managed.organizationId,
              created.standard.organizationId,
            ],
          },
        },
      });
      const byOrg = new Map(modes.map((m) => [m.organizationId, m.mode]));
      expect(byOrg.get(created.managed.organizationId)).toBe("gerenciado");
      expect(byOrg.get(created.standard.organizationId)).toBe("padrao");
      expect(modes.every((m) => m.setBy === partnerOwner)).toBe(true);
    });
  },
);
