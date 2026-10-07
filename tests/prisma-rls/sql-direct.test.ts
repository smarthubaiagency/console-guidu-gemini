import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contextA, ids } from "./fixtures.js";

const directUrl = process.env.DIRECT_DATABASE_URL;
const describeDatabase = directUrl ? describe : describe.skip;

describeDatabase("SQL-level RLS and constraints", () => {
  const prisma = new PrismaClient({ datasourceUrl: directUrl! });

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ current_user: string }>>`select current_user`;
    expect(identity[0]?.current_user).toBe("app_runtime");
  });

  afterAll(() => prisma.$disconnect());

  it("denies invalid context without raising a cast error", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.user_id', 'invalid', true)`;
      await tx.$executeRaw`select set_config('app.workspace_id', 'invalid', true)`;
      await tx.$executeRaw`select set_config('app.organization_id', 'invalid', true)`;
      return tx.$queryRaw<Array<{ id: string }>>`select id from public.spike_notes`;
    });
    expect(rows).toEqual([]);
  });

  it("rejects a cross-workspace composite FK (AC05)", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`select set_config('app.user_id', ${contextA.userId}, true)`;
        await tx.$executeRaw`select set_config('app.workspace_id', ${contextA.workspaceId}, true)`;
        await tx.$executeRaw`select set_config('app.organization_id', ${contextA.organizationId}, true)`;
        await tx.$executeRaw`
          insert into public.spike_notes (id, workspace_id, organization_id, body)
          values (
            ${"30000000-0000-4000-8000-000000000001"}::uuid,
            ${ids.workspaceA}::uuid,
            ${ids.organizationB}::uuid,
            'invalid composite reference'
          )
        `;
      }),
    ).rejects.toThrow();
  });
});

