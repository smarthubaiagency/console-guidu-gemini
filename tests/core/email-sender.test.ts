import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";

import { notify } from "@/core/notifications/notify";
import { emailSender, withSender } from "@/core/notifications/sender";
import type {
  NotificationTransport,
  OutboundMessage,
} from "@/core/notifications/types";

import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "b9000000-0000-4000-8000-0000000000e1";
const OWNER = "d0000000-0000-4000-8000-000000000003";

describeDatabase("CF3a: e-mail sender", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.settings where key like 'email.%'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
  }

  async function setting(
    scope: "platform" | "partner",
    key: string,
    value: string,
    locked = false,
  ) {
    await admin.$executeRawUnsafe(
      `insert into public.settings (scope, partner_id, key, value, locked, updated_by)
       values ($1, $2::uuid, $3, $4::jsonb, $5, '${OWNER}')`,
      scope,
      scope === "partner" ? PARTNER : null,
      key,
      JSON.stringify(value),
      locked,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${PARTNER}', 'agencia-email', 'Agência E-mail')`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("falls back to the brand, then the platform, then the partner", async () => {
    expect(await emailSender(prisma, PARTNER)).toEqual({
      fromName: null,
      replyTo: null,
    });

    await setting("platform", "email.from_name", "GUIDU Avisos");
    await setting("platform", "email.reply_to", "ajuda@guidu.test");
    await setting("partner", "email.from_name", "Agência Azul");
    expect(await emailSender(prisma, PARTNER)).toEqual({
      fromName: "Agência Azul",
      replyTo: "ajuda@guidu.test",
    });
    // Without a partner, only the platform's values.
    expect(await emailSender(prisma, null)).toEqual({
      fromName: "GUIDU Avisos",
      replyTo: "ajuda@guidu.test",
    });
  });

  it("a platform lock wins over the partner's value", async () => {
    await admin.$executeRawUnsafe(
      `update public.settings set locked = true where scope = 'platform' and key = 'email.from_name'`,
    );
    expect((await emailSender(prisma, PARTNER)).fromName).toBe("GUIDU Avisos");
  });

  it("the transport gets the sender and the brand fills the gaps", async () => {
    await admin.$executeRawUnsafe(
      `delete from public.settings where key like 'email.%'`,
    );
    await setting("partner", "email.from_name", "Agência Azul");
    const sent: OutboundMessage[] = [];
    const capture: NotificationTransport = {
      async send(message) {
        sent.push(message);
        return { status: "sent", providerMessageId: "m1" };
      },
    };
    await notify(
      {
        type: "email.test",
        recipientEmail: "dono@agencia.test",
        idempotencyKey: "email-test:1",
        data: {
          settingsUrl: "https://console.agencia.test/admin/settings/email",
        },
      },
      await withSender(prisma, PARTNER, {
        name: "Marca Azul",
        supportEmail: "suporte@agencia.test",
        supportUrl: null,
      }),
      capture,
    );
    expect(sent[0]).toMatchObject({
      to: "dono@agencia.test",
      fromName: "Agência Azul",
      replyTo: "suporte@agencia.test",
      subject: "E-mail de teste de Marca Azul",
    });
  });
});
