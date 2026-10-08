import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { hostedOnlySuite, requiredDatabaseSuite } from "./database-suite.js";
import { withContext } from "../../src/db/with-context.js";
import { contextA, contextB, ids } from "./fixtures.js";

const hostedPoolUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
const pooledUrl = directUrl;
const describeDatabase = requiredDatabaseSuite(
  "app_runtime isolation through Prisma (direct)",
  ["DIRECT_DATABASE_URL"],
);
const describePooler = hostedOnlySuite(
  "Supavisor transaction pool",
  "DATABASE_URL",
);

type RuntimeIdentity = {
  current_user: string;
  rolbypassrls: boolean;
};

describeDatabase("app_runtime isolation through Prisma (direct)", () => {
  const pooled = new PrismaClient({ datasourceUrl: pooledUrl! });
  const direct = new PrismaClient({ datasourceUrl: directUrl! });

  beforeAll(async () => {
    await Promise.all([pooled.$connect(), direct.$connect()]);

    const [pooledIdentity, directIdentity] = await Promise.all([
      pooled.$queryRaw<RuntimeIdentity[]>`
        select current_user, rolbypassrls
        from pg_roles
        where rolname = current_user
      `,
      direct.$queryRaw<RuntimeIdentity[]>`
        select current_user, rolbypassrls
        from pg_roles
        where rolname = current_user
      `,
    ]);
    expect(pooledIdentity[0]).toEqual({
      current_user: "app_runtime",
      rolbypassrls: false,
    });
    expect(directIdentity[0]).toEqual({
      current_user: "app_runtime",
      rolbypassrls: false,
    });
  });

  afterAll(async () => {
    await Promise.all([pooled.$disconnect(), direct.$disconnect()]);
  });

  it.each([
    ["direct client A", pooled],
    ["direct client B", direct],
  ])("reads only the active workspace over %s", async (_label, client) => {
    const rows = await withContext(client, contextA, (tx) =>
      tx.spikeNote.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([ids.noteA]);
  });

  it("denies cross-workspace reads and writes (AC01)", async () => {
    const visible = await withContext(pooled, contextA, (tx) =>
      tx.spikeNote.findUnique({ where: { id: ids.noteB } }),
    );
    expect(visible).toBeNull();

    await expect(
      withContext(pooled, contextA, (tx) =>
        tx.spikeNote.create({
          data: {
            id: randomUUID(),
            workspaceId: ids.workspaceB,
            organizationId: ids.organizationB,
            body: "must be denied",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("denies missing and malformed context (AC02)", async () => {
    expect(await pooled.spikeNote.findMany()).toEqual([]);
    expect(
      await withContext(pooled, { ...contextA, userId: "not-a-uuid" }, (tx) =>
        tx.spikeNote.findMany(),
      ),
    ).toEqual([]);
  });

  it("does not leak context when a pooled connection changes workspace", async () => {
    const [a, b, missing] = await Promise.all([
      withContext(pooled, contextA, (tx) => tx.spikeNote.findMany()),
      withContext(pooled, contextB, (tx) => tx.spikeNote.findMany()),
      pooled.spikeNote.findMany(),
    ]);
    expect(a.map((row) => row.id)).toEqual([ids.noteA]);
    expect(b.map((row) => row.id)).toEqual([ids.noteB]);
    expect(missing).toEqual([]);
  });

  it("clears transaction-local context after rollback", async () => {
    await expect(
      withContext(pooled, contextA, async (tx) => {
        expect(await tx.spikeNote.count()).toBe(1);
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");
    expect(await pooled.spikeNote.findMany()).toEqual([]);
  });

  it("isolates at least 50 concurrent alternating requests", async () => {
    const requests = Array.from({ length: 60 }, async (_, index) => {
      const context = index % 2 === 0 ? contextA : contextB;
      const expectedId = index % 2 === 0 ? ids.noteA : ids.noteB;
      const rows = await withContext(pooled, context, (tx) =>
        tx.spikeNote.findMany(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(expectedId);
    });
    await Promise.all(requests);
  });

  it("measures transaction context overhead", async () => {
    const samples = 30;
    const measure = async (operation: () => Promise<unknown>) => {
      const startedAt = performance.now();
      for (let index = 0; index < samples; index += 1) await operation();
      return (performance.now() - startedAt) / samples;
    };

    const baselineMs = await measure(() =>
      pooled.$transaction((tx) => tx.$queryRaw`select 1`),
    );
    const contextualMs = await measure(() =>
      withContext(pooled, contextA, (tx) => tx.$queryRaw`select 1`),
    );

    console.info(
      `context overhead: baseline=${baselineMs.toFixed(2)}ms contextual=${contextualMs.toFixed(2)}ms delta=${(contextualMs - baselineMs).toFixed(2)}ms (${samples} samples)`,
    );
    expect(baselineMs).toBeGreaterThan(0);
    expect(contextualMs).toBeGreaterThan(0);
  });
});

describePooler("Supavisor transaction pool", () => {
  const hostedPool = new PrismaClient({ datasourceUrl: hostedPoolUrl! });

  afterAll(() => hostedPool.$disconnect());

  it("authenticates app_runtime and executes transaction context", async () => {
    const identity = await hostedPool.$queryRaw<RuntimeIdentity[]>`
      select current_user, rolbypassrls from pg_roles where rolname = current_user
    `;
    expect(identity[0]).toEqual({
      current_user: "app_runtime",
      rolbypassrls: false,
    });
    const rows = await withContext(hostedPool, contextA, (tx) =>
      tx.spikeNote.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([ids.noteA]);
  });
});
