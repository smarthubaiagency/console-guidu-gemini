import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withContext } from "@/lib/prisma/with-context";
import { loadInboxViewer } from "@/modules/inbox/server/access";
import { setAttendantMark } from "@/modules/inbox/server/attendants";
import { createLabel } from "@/modules/inbox/server/labels";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * IN4a and IN4b through the web's role (app_runtime): the owner marks
 * itself as attendant and creates a label. The table grants insert only on
 * the columns the app writes, so the client must leave `created_at` and
 * `updated_at` to the database (a Prisma `@default(now())` sent them and
 * every mark failed with "permission denied for table inbox_attendants").
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const LABEL = "Etiqueta IN4b app";

describeDatabase(
  "Inbox: attendant mark and label as app_runtime",
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
        `delete from public.inbox_attendants where workspace_id = '${ids.workspaceA}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.inbox_labels where workspace_id = '${ids.workspaceA}' and name = '${LABEL}'`,
      );
    }

    beforeAll(cleanup);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("the owner marks itself as attendant", async () => {
      const result = await withContext(prisma, contextA, (tx) =>
        setAttendantMark(tx, contextA, { userId: ids.userA, marked: true }),
      );
      expect(result).toEqual({ changed: true });
      const row = await admin.inboxAttendant.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: ids.workspaceA,
            userId: ids.userA,
          },
        },
        select: { createdBy: true, createdAt: true },
      });
      expect(row?.createdBy).toBe(ids.userA);
      expect(row?.createdAt).toBeInstanceOf(Date);
    });

    it("the owner creates a label", async () => {
      const label = await withContext(prisma, contextA, async (tx) =>
        createLabel(tx, contextA, await loadInboxViewer(tx, ids.userA), {
          name: LABEL,
          color: "info",
        }),
      );
      expect(label.name).toBe(LABEL);
    });
  },
);
