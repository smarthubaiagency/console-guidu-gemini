import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withContext } from "../../src/db/with-context.js";
import { contextA, contextB, ids } from "./fixtures.js";

const pooledUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_DATABASE_URL;
const describeDatabase = pooledUrl && directUrl ? describe : describe.skip;

describeDatabase("app_runtime isolation through Prisma", () => {
  const pooled = new PrismaClient({ datasourceUrl: pooledUrl! });
  const direct = new PrismaClient({ datasourceUrl: directUrl! });

  beforeAll(async () => {
    await Promise.all([pooled.$connect(), direct.$connect()]);

    const [pooledIdentity, directIdentity] = await Promise.all([
      pooled.$queryRaw<Array<{ current_user: string; rolbypassrls: boolean }>>`
        select current_user, rolbypassrls
        from pg_roles
        where rolname = current_user
      `,
      direct.$queryRaw<Array<{ current_user: string; rolbypassrls: boolean }>>`
        select current_user, rolbypassrls
        from pg_roles
        where rolname = current_user
      `,
    ]);
    expect(pooledIdentity[0]?.current_user).toBe("app_runtime");
    expect(directIdentity[0]?.current_user).toBe("app_runtime");
    expect(pooledIdentity[0]?.rolbypassrls).toBe(false);
    expect(directIdentity[0]?.rolbypassrls).toBe(false);
  });

  afterAll(async () => {
    await Promise.all([pooled.$disconnect(), direct.$disconnect()]);
  });

  it.each([
    ["Supavisor transaction pool", pooled],
    ["direct connection", direct],
  ])("reads only the active workspace over %s", async (_label, client) => {
    const rows = await withContext(client, contextA, (tx) => tx.spikeNote.findMany());
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
      await withContext(
        pooled,
        { ...contextA, userId: "not-a-uuid" },
        (tx) => tx.spikeNote.findMany(),
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
      const rows = await withContext(pooled, context, (tx) => tx.spikeNote.findMany());
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(expectedId);
    });
    await Promise.all(requests);
  });
});

