import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EmailTemplateInvalidError,
  inheritedEmailTemplate,
  restoreEmailTemplate,
  saveEmailTemplate,
  type EmailTemplateActor,
} from "@/core/email/templates";
import { notify } from "@/core/notifications/notify";
import { emailTemplateFor } from "@/core/notifications/template-store";
import type {
  NotificationTransport,
  OutboundMessage,
} from "@/core/notifications/types";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * CF3b: e-mail templates. The platform edits the base over the code, the
 * partner overrides it for its customers; sending picks the partner's,
 * else the platform's, else the code's template.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "bcf30000-0000-4000-8000-0000000000b1";
const PLATFORM_OWNER = "d0000000-0000-4000-8000-000000000003";

describeDatabase("CF3b: e-mail templates", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const platform: EmailTemplateActor = {
    level: "platform",
    userId: PLATFORM_OWNER,
    platformRole: "owner",
  };
  const partner: EmailTemplateActor = {
    level: "partner",
    userId: ids.userA,
    partnerId: PARTNER,
    partnerRole: "partner_owner",
  };

  const inPlatform = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, PLATFORM_OWNER, op);
  const inPartner = <T>(op: (tx: ContextTransaction) => Promise<T>) =>
    withIdentityContext(prisma, ids.userA, op, { partnerId: PARTNER });

  async function cleanup() {
    await admin.$executeRawUnsafe(`delete from public.email_templates`);
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${PARTNER}'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name)
       values ('${PARTNER}', 'agencia-cf3b', 'Agência CF3b')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role)
       values ('${PARTNER}', '${ids.userA}', 'owner@cf3b.test', 'partner_owner')`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("the platform saves the base and it is audited", async () => {
    await inPlatform((tx) =>
      saveEmailTemplate(tx, platform, {
        eventType: "email.test",
        locale: "pt-BR",
        subject: "Teste da plataforma {{marca}}",
        body: "Olá!\r\n\r\n[Abrir]({{link}})",
      }),
    );
    const stored = await emailTemplateFor(prisma, null, "email.test", "pt-BR");
    expect(stored).toEqual({
      scope: "platform",
      subject: "Teste da plataforma {{marca}}",
      body: "Olá!\n\n[Abrir]({{link}})",
    });
    const audit = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from public.audit_events
       where action = 'platform.email_template.save'
         and resource_id = 'email.test:pt-BR'`,
    );
    expect(Number(audit[0]?.count)).toBeGreaterThan(0);
  });

  it("refuses unknown tags, bad links and unknown events", async () => {
    await expect(
      inPlatform((tx) =>
        saveEmailTemplate(tx, platform, {
          eventType: "email.test",
          locale: "pt-BR",
          subject: "Sua senha: {{senha}}",
          body: "x",
        }),
      ),
    ).rejects.toBeInstanceOf(EmailTemplateInvalidError);
    await expect(
      inPlatform((tx) =>
        saveEmailTemplate(tx, platform, {
          eventType: "email.test",
          locale: "pt-BR",
          subject: "x",
          body: "[x](javascript:alert(1))",
        }),
      ),
    ).rejects.toBeInstanceOf(EmailTemplateInvalidError);
    await expect(
      inPlatform((tx) =>
        saveEmailTemplate(tx, platform, {
          eventType: "auth.password",
          locale: "pt-BR",
          subject: "x",
          body: "y",
        }),
      ),
    ).rejects.toThrow();
  });

  it("the partner inherits the base and overrides it", async () => {
    const inherited = await inPartner((tx) =>
      inheritedEmailTemplate(tx, partner, "email.test", "pt-BR"),
    );
    expect(inherited.source).toBe("platform");

    await inPartner((tx) =>
      saveEmailTemplate(tx, partner, {
        eventType: "email.test",
        locale: "pt-BR",
        subject: "Teste da agência",
        body: "**Oi**",
      }),
    );
    expect(
      (await emailTemplateFor(prisma, PARTNER, "email.test", "pt-BR"))?.subject,
    ).toBe("Teste da agência");
    // Without a partner, and in another language, the platform or the code.
    expect(
      (await emailTemplateFor(prisma, null, "email.test", "pt-BR"))?.subject,
    ).toBe("Teste da plataforma {{marca}}");
    expect(await emailTemplateFor(prisma, PARTNER, "email.test", "en")).toBe(
      null,
    );
  });

  it("partner support cannot edit", async () => {
    await expect(
      inPartner((tx) =>
        saveEmailTemplate(
          tx,
          { ...partner, partnerRole: "partner_support" },
          {
            eventType: "email.test",
            locale: "pt-BR",
            subject: "x",
            body: "y",
          },
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("sending uses the partner's template with escaped values", async () => {
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
        idempotencyKey: "email-test:cf3b",
        data: { settingsUrl: "https://console.agencia.test/admin" },
      },
      { name: "Marca <B>", supportEmail: null, supportUrl: null },
      capture,
      {
        locale: "pt-BR",
        template: await emailTemplateFor(
          prisma,
          PARTNER,
          "email.test",
          "pt-BR",
        ),
      },
    );
    expect(sent[0]?.subject).toBe("Teste da agência");
    expect(sent[0]?.html).toContain("<strong>Oi</strong>");
    expect(sent[0]?.html).toContain("Marca &lt;B&gt;");
  });

  it("restore removes the level's template only", async () => {
    expect(
      await inPartner((tx) =>
        restoreEmailTemplate(tx, partner, {
          eventType: "email.test",
          locale: "pt-BR",
        }),
      ),
    ).toBe(true);
    expect(
      (await emailTemplateFor(prisma, PARTNER, "email.test", "pt-BR"))?.scope,
    ).toBe("platform");
    await inPlatform((tx) =>
      restoreEmailTemplate(tx, platform, {
        eventType: "email.test",
        locale: "pt-BR",
      }),
    );
    expect(await emailTemplateFor(prisma, PARTNER, "email.test", "pt-BR")).toBe(
      null,
    );
  });
});
