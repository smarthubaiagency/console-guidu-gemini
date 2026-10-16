import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QuotaExceededError } from "@/core/entitlements/quotas";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import type {
  AnalysisContext,
  ReviewSummary,
} from "@/modules/google-business/analyses/contract";
import { intelligenceAnalyses } from "@/modules/google-business/analyses/intelligence";
import { createFakeSuggestionsAi } from "@/modules/google-business/analyses/intelligence/ai-engine";
import { runMapsHealth } from "@/modules/google-business/analyses/intelligence/maps-health";
import { runWithIntelligenceRuntime } from "@/modules/google-business/analyses/intelligence/runtime";
import { googleBusinessDataContract } from "@/modules/google-business/data";
import { createFakeMapsProvider } from "@/modules/google-business/maps/provider/fake";
import {
  addMapsKeyword,
  listMapsKeywords,
  listReferenceCompetitors,
  loadMapsHealthView,
  setMapsKeywordStatus,
  setReferenceCompetitor,
} from "@/modules/google-business/maps/service";
import { AppError } from "@/shared/errors";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;

const owner: RequestContext = { ...contextA, principalType: "user" };
const viewer: RequestContext = { ...owner, userId: ids.userMultiOrg };
const UNIT = "9b1b0000-0000-4000-8000-0000000000c1";

function review(
  days: number,
  rating: ReviewSummary["rating"],
  replied: boolean,
): ReviewSummary {
  return {
    externalId: `r${days}`,
    rating,
    text: "Bom atendimento.",
    authorName: "Ana Souza",
    createdAt: new Date(
      Date.UTC(2026, 9, 16) - days * 86_400_000,
    ).toISOString(),
    replied,
    replyText: null,
  };
}

function context(request: RequestContext, readAt: string): AnalysisContext {
  return {
    request,
    locationId: "gb-location-of-gb1a",
    unitId: UNIT,
    snapshot: {
      provider: "fake",
      externalId: "x",
      placeId: "fake-place-target",
      name: "Clínica Sorriso",
      primaryCategory: "Dentista",
      additionalCategories: ["Clínica odontológica"],
      description: null,
      phone: "+55 11 3000-0000",
      website: null,
      address: {
        lines: ["Rua A, 1"],
        locality: "São Paulo",
        administrativeArea: "SP",
        postalCode: null,
        countryCode: "BR",
      },
      latitude: null,
      longitude: null,
      timeZone: "America/Sao_Paulo",
      regularHours: [],
      specialHours: [],
      rating: 4.6,
      reviewCount: 4,
      photoCount: 2,
      attributes: {},
      readAt,
    },
    reviews: [
      review(3, 5, true),
      review(20, 4, false),
      review(70, 2, false),
      review(130, 5, true),
    ],
  };
}

describeDatabase(
  "GB1b: Saúde no Maps (keywords, competitors, measurements, quotas)",
  { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl },
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    let clock = new Date("2026-10-16T12:00:00Z");
    const runtime = {
      transaction: <T>(
        ctx: RequestContext,
        op: Parameters<typeof withContext<T>>[2],
      ) => withContext(prisma, ctx, op),
      maps: createFakeMapsProvider(),
      locator: null,
      ai: createFakeSuggestionsAi(),
      now: () => clock,
    };
    const run = <T>(
      ctx: RequestContext,
      fn: Parameters<typeof withContext<T>>[2],
    ) => withContext(prisma, ctx, fn);

    async function cleanup() {
      for (const table of [
        "gb_maps_scan_results",
        "gb_maps_scans",
        "gb_maps_competitors",
        "gb_maps_keywords",
      ]) {
        await admin.$executeRawUnsafe(
          `delete from public.${table} where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
        );
      }
      await admin.$executeRawUnsafe(
        `delete from public.workspace_locations where id = '${UNIT}'`,
      );
    }

    beforeAll(async () => {
      await cleanup();
      // The unit has its own coordinates: the centre of the grid.
      await admin.$executeRawUnsafe(
        `insert into public.workspace_locations (id, organization_id, workspace_id, name, latitude, longitude, created_by)
         values ('${UNIT}', '${ids.organizationA}', '${ids.workspaceA}', 'Loja Centro', -23.5505, -46.6333, '${ids.userA}')`,
      );
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("declares the four intelligence analyses of the contract", () => {
      expect(
        intelligenceAnalyses.map((a) => [a.key, a.phase, a.usesAi]),
      ).toEqual([
        ["ai-suggestions", "blocking", true],
        ["maps-keywords", "background", false],
        ["maps-competitors", "background", false],
        ["maps-geo-grid", "background", false],
      ]);
    });

    it("records the starting point on the first run, shared by the three analyses", async () => {
      const ctx = context(owner, "2026-10-16T12:00:00.000Z");
      const results = await runWithIntelligenceRuntime(runtime, () =>
        Promise.all(intelligenceAnalyses.map((analysis) => analysis.run(ctx))),
      );
      const [ai, keywords, competitors, grid] = results;
      expect(ai!.status).toBe("done");
      expect(ai!.findings.some((f) => f.key.startsWith("reply-"))).toBe(true);
      expect(keywords).toMatchObject({
        status: "done",
        metrics: { keywords: 3, created: 3 },
      });
      expect(competitors!.status).toBe("done");
      expect(grid!.status).toBe("done");
      expect(grid!.metrics).toMatchObject({
        baseline: 1,
        gridSize: 7,
        points: 49,
        keywords: 3,
        apiCalls: 147,
        costMicros: 0,
      });
      expect(grid!.findings.map((f) => f.key)).toEqual(
        expect.arrayContaining([
          "maps-score",
          "maps-solv-1",
          "maps-solv-2",
          "maps-solv-3",
          "maps-baseline",
        ]),
      );

      // One measurement only, marked as the starting point.
      const scans = await admin.gbMapsScan.findMany({
        where: { locationId: UNIT },
        include: { results: true },
      });
      expect(scans).toHaveLength(1);
      expect(scans[0]).toMatchObject({
        isBaseline: true,
        gridSize: 7,
        radiusM: 5000,
        keywordCount: 3,
        provider: "fake",
      });
      expect(scans[0]!.results).toHaveLength(3);
      expect((scans[0]!.results[0]!.ranks as unknown[]).length).toBe(7);

      const keywordList = await run(owner, (tx) =>
        listMapsKeywords(tx, owner, UNIT),
      );
      expect(keywordList.map((k) => [k.keyword, k.source])).toEqual([
        ["dentista", "agent"],
        ["dentista perto de mim", "agent"],
        ["clínica odontológica", "agent"],
      ]);
      const references = await run(owner, (tx) =>
        listReferenceCompetitors(tx, owner, UNIT),
      );
      expect(references).toHaveLength(5);

      const view = await run(viewer, (tx) =>
        loadMapsHealthView(tx, viewer, UNIT),
      );
      expect(view).toMatchObject({
        isBaseline: true,
        gridSize: 7,
        radiusKm: 5,
        baseline: null,
      });
      expect(view!.keywords).toHaveLength(3);
      expect(
        view!.keywords[0]!.competitors.filter((c) => c.isReference),
      ).toHaveLength(5);
      expect(view!.score).toBe(grid!.metrics!.score);
      expect(view!.breakdown.map((d) => d.key)).toEqual([
        "visibility",
        "reviews",
        "activity",
        "profile",
      ]);
    });

    it("reuses a measurement of the last 30 minutes instead of paying again", async () => {
      const result = await runWithIntelligenceRuntime(runtime, () =>
        runMapsHealth(context(owner, "2026-10-16T12:05:00.000Z")),
      );
      expect(result.geoGrid).toMatchObject({
        status: "done",
        metrics: { reused: 1 },
      });
      expect(
        await admin.gbMapsScan.count({ where: { locationId: UNIT } }),
      ).toBe(1);
    });

    it("counts later measurements against the monthly quota, not the starting point", async () => {
      clock = new Date("2026-10-17T12:00:00Z");
      const second = await runWithIntelligenceRuntime(runtime, () =>
        runMapsHealth(context(owner, "2026-10-17T12:00:00.000Z")),
      );
      expect(second.geoGrid).toMatchObject({
        status: "done",
        metrics: { baseline: 0 },
      });
      expect(second.geoGrid.findings.map((f) => f.key)).toContain(
        "maps-progress",
      );

      clock = new Date("2026-10-18T12:00:00Z");
      const third = await runWithIntelligenceRuntime(runtime, () =>
        runMapsHealth(context(owner, "2026-10-18T12:00:00.000Z")),
      );
      // Default plan: one measurement per unit per month.
      expect(third.geoGrid).toMatchObject({ status: "skipped" });
      expect(third.geoGrid.findings[0]).toMatchObject({
        key: "maps-quota",
        values: { used: 1, limit: 1 },
      });
      expect(third.keywords.status).toBe("done");

      const view = await run(owner, (tx) =>
        loadMapsHealthView(tx, owner, UNIT),
      );
      expect(view).toMatchObject({ isBaseline: false });
      expect(view!.baseline).not.toBeNull();
    });

    it("lets a viewer read but never run the measurement", async () => {
      clock = new Date("2026-11-02T12:00:00Z");
      const result = await runWithIntelligenceRuntime(runtime, () =>
        runMapsHealth(context(viewer, "2026-11-02T12:00:00.000Z")),
      );
      expect(result.geoGrid.status).toBe("failed");
      await expect(
        run(viewer, (tx) =>
          addMapsKeyword(tx, viewer, UNIT, { keyword: "ortodontista" }),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("keeps the keywords within the plan quota", async () => {
      await expect(
        run(owner, (tx) =>
          addMapsKeyword(tx, owner, UNIT, { keyword: "ortodontista" }),
        ),
      ).rejects.toBeInstanceOf(QuotaExceededError);
      const [first] = await run(owner, (tx) =>
        listMapsKeywords(tx, owner, UNIT),
      );
      await run(owner, (tx) =>
        setMapsKeywordStatus(tx, owner, first!.id, "paused"),
      );
      const added = await run(owner, (tx) =>
        addMapsKeyword(tx, owner, UNIT, { keyword: " Ortodontista " }),
      );
      expect(added).toMatchObject({
        keyword: "ortodontista",
        source: "user",
        status: "active",
      });
      await expect(
        run(owner, (tx) =>
          addMapsKeyword(tx, owner, UNIT, { keyword: "ORTODONTISTA" }),
        ),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        run(owner, (tx) =>
          setMapsKeywordStatus(tx, owner, first!.id, "active"),
        ),
      ).rejects.toBeInstanceOf(QuotaExceededError);
    });

    it("marks and unmarks reference competitors by place id", async () => {
      const marked = await run(owner, (tx) =>
        setReferenceCompetitor(tx, owner, UNIT, "ChIJ-novo", true),
      );
      expect(marked).toMatchObject({
        placeId: "ChIJ-novo",
        source: "user",
        status: "active",
      });
      const removed = await run(owner, (tx) =>
        setReferenceCompetitor(tx, owner, UNIT, "ChIJ-novo", false),
      );
      expect(removed.status).toBe("removed");
      await expect(
        run(owner, (tx) =>
          setReferenceCompetitor(tx, owner, UNIT, "not valid!", true),
        ),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("hides the unit from another workspace", async () => {
      const other: RequestContext = { ...contextB, principalType: "user" };
      await expect(
        run(other, (tx) => loadMapsHealthView(tx, other, UNIT)),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("exports the maps data of the workspace (F3e)", async () => {
      const exported = await run(owner, (tx) =>
        googleBusinessDataContract.export(tx, owner),
      );
      expect(exported.maps_keywords!.length).toBe(4);
      expect(exported.maps_scans!.length).toBe(2);
      expect(exported.maps_scan_results!.length).toBe(6);
      expect(exported.maps_competitors!.length).toBe(6);
      expect(JSON.stringify(exported)).not.toMatch(/latitude|longitude/);
    });
  },
);
