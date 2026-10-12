import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { flattenMessages } from "@/core/i18n/locales";
import {
  latestTextsRun,
  requestTextsTranslation,
} from "@/core/i18n/machine/requests";
import {
  translateMissingTexts,
  translateTextsJob,
} from "@/core/i18n/machine/texts-job";
import type { MachineTranslator } from "@/core/i18n/machine/types";
import { SOURCE_MESSAGES } from "@/core/i18n/messages-loader";
import {
  addLanguage,
  type LanguageActor,
  listTexts,
  saveText,
} from "@/core/i18n/service";
import type { JobDefinition } from "@/core/jobs/definition";
import {
  latestLegalTranslationRuns,
  requestLegalTranslation,
} from "@/core/legal/machine";
import { translateDocumentJob } from "@/core/legal/machine-job";
import {
  type LegalPublisher,
  listLegalTranslations,
  publishLegalDocument,
  saveLegalTranslation,
} from "@/core/legal/service";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const platformOwner = "d0000000-0000-4000-8000-000000000003";
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const partnerFinance = "d0000000-0000-4000-8000-000000000005";
const partnerId = "b0000000-0000-4000-8000-0000000000e6";
const code = "fr";
const manualKey = "nav.items.core_overview";

const owner: LanguageActor = { userId: platformOwner, platformRole: "owner" };
const support: LanguageActor = {
  userId: platformOwner,
  platformRole: "support",
};
const legalOwner: LegalPublisher = {
  userId: partnerOwner,
  partnerRole: "partner_owner",
};

const sourceTexts = flattenMessages(SOURCE_MESSAGES);
const total = Object.keys(sourceTexts).length;

describeDatabase("I6: machine translation", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const workerDb = new PrismaClient({
    datasources: { db: { url: workerUrl ?? "" } },
  });
  const startedAt = new Date().toISOString();
  const previousProvider = process.env.TRANSLATION_PROVIDER;

  const asUser = <T>(
    userId: string,
    fn: (tx: ContextTransaction) => Promise<T>,
    partner?: string,
  ) =>
    withIdentityContext(prisma, userId, fn, {
      ...(partner ? { partnerId: partner } : {}),
    });

  /** What the worker runtime does for a platform run, as app_worker. */
  async function runAsWorker(
    runId: string,
    definition: JobDefinition<unknown>,
  ): Promise<Record<string, unknown>> {
    return workerDb.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ payload: unknown }[]>`
          select payload from public.job_runs where id = ${runId}::uuid
        `;
        await tx.$executeRaw`
          update public.job_runs set status = 'running', started_at = now()
          where id = ${runId}::uuid
        `;
        if (definition.scope !== "platform") throw new Error("platform only");
        const payload = definition.payload.parse(row!.payload);
        const result = (await definition.run(tx, payload)) ?? {};
        await tx.$executeRaw`
          update public.job_runs set status = 'succeeded', finished_at = now(),
            attempts = attempts + 1, result = ${JSON.stringify(result)}::jsonb
          where id = ${runId}::uuid
        `;
        return result as Record<string, unknown>;
      },
      { timeout: 60_000 },
    );
  }

  const auditCount = async (action: string, resourceId: string) => {
    const rows = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from public.audit_events where action = '${action}'
         and resource_id = '${resourceId}' and occurred_at >= '${startedAt}'`,
    );
    return Number(rows[0]!.count);
  };

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where kind in ('i18n.translate-texts', 'legal.translate-document')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.platform_translations where locale in ('${code}', 'en')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.platform_languages where code = '${code}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.partners where id = '${partnerId}'`,
    );
  }

  beforeAll(async () => {
    process.env.TRANSLATION_PROVIDER = "fake";
    await cleanup();
    await asUser(platformOwner, (tx) =>
      addLanguage(tx, owner, { code, name: "Français" }),
    );
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-i6', 'Agência I6')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
        ('${partnerId}', '${partnerOwner}', 'owner@i6.test', 'partner_owner'),
        ('${partnerId}', '${partnerFinance}', 'fin@i6.test', 'partner_finance')`,
    );
  });

  afterEach(() => {
    process.env.TRANSLATION_PROVIDER = "fake";
  });

  afterAll(async () => {
    await cleanup();
    if (previousProvider === undefined) delete process.env.TRANSLATION_PROVIDER;
    else process.env.TRANSLATION_PROVIDER = previousProvider;
    await prisma.$disconnect();
    await admin.$disconnect();
    await workerDb.$disconnect();
  });

  it("fills only the missing texts of a new language, never a manual one", async () => {
    await asUser(platformOwner, (tx) =>
      saveText(tx, owner, code, { key: manualKey, value: "Aperçu manuel" }),
    );
    const run = await asUser(platformOwner, (tx) =>
      requestTextsTranslation(tx, owner, code),
    );
    // One run in flight per language.
    await expect(
      asUser(platformOwner, (tx) => requestTextsTranslation(tx, owner, code)),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "conflict",
    );
    const queued = await asUser(platformOwner, (tx) =>
      latestTextsRun(tx, owner, code),
    );
    expect(queued).toMatchObject({ id: run.id, status: "pending" });
    expect(queued?.payload).toEqual({
      locale: code,
      requestedBy: platformOwner,
    });

    const result = await runAsWorker(
      run.id,
      translateTextsJob as unknown as JobDefinition<unknown>,
    );
    expect(result).toMatchObject({
      locale: code,
      provider: "fake",
      missing: total - 1,
      translated: total - 1,
      invalid: 0,
      skipped: 0,
      remaining: 0,
    });

    const rows = await admin.platformTranslation.findMany({
      where: { locale: code },
    });
    expect(rows).toHaveLength(total);
    const manual = rows.find((r) => r.key === manualKey)!;
    expect(manual).toMatchObject({ value: "Aperçu manuel", origin: "manual" });
    const machine = rows.filter((r) => r.origin === "machine");
    expect(machine).toHaveLength(total - 1);
    expect(machine.every((r) => r.updatedBy === null)).toBe(true);
    expect(machine.find((r) => r.key === "languages.title")?.value).toMatch(
      "[fr]Idiomas",
    );

    // The "Automáticos a revisar" filter lists them; saving one makes it manual.
    const review = await asUser(platformOwner, (tx) =>
      listTexts(tx, owner, code, { filter: "machine", size: 10 }),
    );
    expect(review.total).toBe(total - 1);
    const first = review.rows[0]!;
    await asUser(platformOwner, (tx) =>
      saveText(tx, owner, code, { key: first.key, value: first.current }),
    );
    const after = await asUser(platformOwner, (tx) =>
      listTexts(tx, owner, code, { filter: "machine", size: 10 }),
    );
    expect(after.total).toBe(total - 2);

    const done = await asUser(platformOwner, (tx) =>
      latestTextsRun(tx, owner, code),
    );
    expect(done).toMatchObject({ status: "succeeded" });
    expect(done?.result).toMatchObject({ translated: total - 1 });
    expect(await auditCount("platform.translation.machine_request", code)).toBe(
      1,
    );
    expect(await auditCount("platform.translation.machine", code)).toBe(1);

    // A second run has nothing left to fill.
    const again = await asUser(platformOwner, (tx) =>
      requestTextsTranslation(tx, owner, code),
    );
    expect(
      await runAsWorker(
        again.id,
        translateTextsJob as unknown as JobDefinition<unknown>,
      ),
    ).toMatchObject({ missing: 0, translated: 0 });
  });

  it("built-in languages ship every text: nothing to fill", async () => {
    const run = await asUser(platformOwner, (tx) =>
      requestTextsTranslation(tx, owner, "en"),
    );
    const result = await runAsWorker(
      run.id,
      translateTextsJob as unknown as JobDefinition<unknown>,
    );
    expect(result).toMatchObject({ missing: 0, translated: 0 });
    expect(
      await admin.platformTranslation.count({ where: { locale: "en" } }),
    ).toBe(0);
  });

  it("skips and counts invalid or missing answers", async () => {
    await admin.$executeRawUnsafe(
      `delete from public.platform_translations where locale = '${code}' and origin = 'machine'`,
    );
    const broken: MachineTranslator = {
      provider: "test",
      async translateTexts(_s, _t, entries) {
        const out: Record<string, string> = {};
        entries.forEach((e, i) => {
          if (i % 3 === 0) return; // no answer
          // Arguments lost on every text that has them.
          out[e.key] = e.text.includes("{") ? "Sans arguments" : `FR ${e.text}`;
        });
        return out;
      },
      async translateDocument() {
        throw new Error("unused");
      },
    };
    const withArgs = Object.values(sourceTexts).filter((t) =>
      t.includes("{"),
    ).length;
    const [run] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `insert into public.job_runs (kind, scope, payload, idempotency_key)
       values ('i18n.translate-texts', 'platform',
               '{"locale": "${code}", "requestedBy": "${platformOwner}"}', 'i6-broken')
       returning id`,
    );
    const result = await workerDb.$transaction(async (tx) => {
      await tx.$executeRaw`update public.job_runs set status = 'running' where id = ${run!.id}::uuid`;
      return translateMissingTexts(
        tx,
        { locale: code, requestedBy: platformOwner },
        broken,
      );
    });
    expect(result.skipped + result.invalid + result.translated).toBe(
      result.missing,
    );
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.invalid).toBeGreaterThan(0);
    expect(result.invalid).toBeLessThanOrEqual(withArgs);
    const saved = await admin.platformTranslation.findMany({
      where: { locale: code, origin: "machine" },
    });
    expect(saved).toHaveLength(result.translated);
    expect(saved.every((r) => !r.value.includes("Sans arguments"))).toBe(true);
  });

  it("refuses without permission or provider", async () => {
    await expect(
      asUser(platformOwner, (tx) => requestTextsTranslation(tx, support, code)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // A workspace member forging a platform role is stopped by RLS.
    await expect(
      asUser(ids.userA, (tx) =>
        requestTextsTranslation(
          tx,
          { userId: ids.userA, platformRole: "owner" },
          code,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(platformOwner, (tx) =>
        requestTextsTranslation(tx, owner, "pt-BR"),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "invalid_input",
    );
    delete process.env.TRANSLATION_PROVIDER;
    const key = process.env.TRANSLATION_ANTHROPIC_API_KEY;
    delete process.env.TRANSLATION_ANTHROPIC_API_KEY;
    try {
      await expect(
        asUser(platformOwner, (tx) => requestTextsTranslation(tx, owner, code)),
      ).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof AppError &&
          e.messageKey === "languages.auto.notConfigured",
      );
    } finally {
      if (key !== undefined) process.env.TRANSLATION_ANTHROPIC_API_KEY = key;
    }
  });

  it("fills the missing translations of a legal version", async () => {
    await asUser(
      partnerOwner,
      (tx) =>
        publishLegalDocument(tx, legalOwner, partnerId, {
          kind: "terms",
          title: "Termos",
          body: "1. Uso\n\nTexto original",
          requiresAcceptance: true,
        }),
      partnerId,
    );
    const [doc] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `select id from public.partner_legal_documents where partner_id = '${partnerId}'`,
    );
    const documentId = doc!.id;
    await asUser(
      partnerOwner,
      (tx) =>
        saveLegalTranslation(tx, legalOwner, partnerId, documentId, "en", {
          title: "Terms",
          body: "Manual text",
        }),
      partnerId,
    );

    // partner_finance does not publish.
    await expect(
      asUser(
        partnerFinance,
        (tx) =>
          requestLegalTranslation(
            tx,
            { userId: partnerFinance, partnerRole: "partner_finance" },
            partnerId,
            documentId,
          ),
        partnerId,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const run = await asUser(
      partnerOwner,
      (tx) => requestLegalTranslation(tx, legalOwner, partnerId, documentId),
      partnerId,
    );
    await expect(
      asUser(
        partnerOwner,
        (tx) => requestLegalTranslation(tx, legalOwner, partnerId, documentId),
        partnerId,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "conflict",
    );
    const result = await runAsWorker(
      run.id,
      translateDocumentJob as unknown as JobDefinition<unknown>,
    );
    // Active languages pt-BR (original), en (manual) and es: only es is
    // missing; the draft fr is not an active language.
    expect(result).toMatchObject({
      documentId,
      provider: "fake",
      missing: 1,
      translated: 1,
      invalid: 0,
      skipped: 0,
    });
    const translations = await asUser(
      partnerOwner,
      (tx) => listLegalTranslations(tx, documentId),
      partnerId,
    );
    expect(
      translations.map((t) => [t.locale, t.origin, t.title, t.body]),
    ).toEqual([
      ["en", "manual", "Terms", "Manual text"],
      ["es", "machine", "[es] Termos", "[es] 1. Uso\n\n[es] Texto original"],
    ]);
    const runs = await asUser(
      partnerOwner,
      (tx) => latestLegalTranslationRuns(tx, partnerId),
      partnerId,
    );
    expect(runs[documentId]).toMatchObject({ status: "succeeded" });
    // Another member without the publishing role does not see the runs.
    const hidden = await asUser(
      partnerFinance,
      (tx) => latestLegalTranslationRuns(tx, partnerId),
      partnerId,
    );
    expect(hidden).toEqual({});
    expect(
      await auditCount("legal.translation.machine_request", partnerId),
    ).toBe(1);
    expect(await auditCount("legal.translation.machine", partnerId)).toBe(1);
  });
});
