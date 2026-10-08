import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";

import { withIdentityContext } from "../../src/lib/prisma/with-identity-context.js";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const pooledUrl = process.env.DATABASE_URL;
const requiredVars = { DATABASE_URL: pooledUrl };

const identityA = "30000000-0000-4000-8000-000000000001";
const identityB = "30000000-0000-4000-8000-000000000002";
const blocked = "30000000-0000-4000-8000-000000000003";

describeDatabase("profiles through the identity context", requiredVars, () => {
  const prisma = new PrismaClient({ datasourceUrl: pooledUrl! });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reads only the profile of the identity in context", async () => {
    const rows = await withIdentityContext(prisma, identityA, (tx) =>
      tx.profile.findMany(),
    );
    expect(rows.map((row) => row.id)).toEqual([identityA]);
  });

  it("hides another identity's profile", async () => {
    const row = await withIdentityContext(prisma, identityA, (tx) =>
      tx.profile.findUnique({ where: { id: identityB } }),
    );
    expect(row).toBeNull();
  });

  it("denies reads without any context", async () => {
    const rows = await prisma.profile.findMany();
    expect(rows).toEqual([]);
  });

  it("refuses to write another identity's profile", async () => {
    await expect(
      withIdentityContext(prisma, identityA, (tx) =>
        tx.profile.update({
          where: { id: identityB },
          data: { fullName: "Hijacked" },
        }),
      ),
    ).rejects.toThrow();

    const untouched = await withIdentityContext(prisma, identityB, (tx) =>
      tx.profile.findUniqueOrThrow({ where: { id: identityB } }),
    );
    expect(untouched.fullName).toBe("Identity B");
  });

  it("refuses to write a blocked identity's own profile (AC03)", async () => {
    await expect(
      withIdentityContext(prisma, blocked, (tx) =>
        tx.profile.update({
          where: { id: blocked },
          data: { fullName: "Blocked write" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("still lets a blocked identity be read, so the server can deny", async () => {
    const row = await withIdentityContext(prisma, blocked, (tx) =>
      tx.profile.findUniqueOrThrow({ where: { id: blocked } }),
    );
    expect(row.status).toBe("blocked");
  });

  it("rolls the context back with the transaction", async () => {
    await withIdentityContext(prisma, identityA, async () => undefined);
    const [leaked] = await prisma.$queryRaw<{ value: string | null }[]>`
      select current_setting('app.user_id', true) as value
    `;
    expect(leaked?.value ?? "").toBe("");
  });
});
