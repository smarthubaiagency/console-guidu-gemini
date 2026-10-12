import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deleteLegalTranslation,
  latestLocalizedLegalDocument,
  legalTranslationLanguages,
  listLegalTranslations,
  localizeLegalDocuments,
  pendingLegalDocuments,
  publishLegalDocument,
  saveLegalTranslation,
  type LegalPublisher,
} from "@/core/legal/service";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";
import { AppError } from "@/shared/errors";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const platformOwner = "d0000000-0000-4000-8000-000000000003";
const partnerOwner = "d0000000-0000-4000-8000-000000000004";
const partnerFinance = "d0000000-0000-4000-8000-000000000005";
const outsider = "d0000000-0000-4000-8000-000000000006";
const partnerId = "b0000000-0000-4000-8000-0000000000d5";

const withKey = (code: string, messageKey: string) => (e: unknown) =>
  e instanceof AppError && e.code === code && e.messageKey === messageKey;

describeDatabase(
  "I5: legal documents per dashboard language",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });

    const owner: LegalPublisher = {
      userId: partnerOwner,
      partnerRole: "partner_owner",
    };
    const asUser = <T>(
      userId: string,
      fn: (tx: ContextTransaction) => Promise<T>,
      partner = partnerId,
    ) => withIdentityContext(prisma, userId, fn, { partnerId: partner });

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `delete from public.legal_acceptances where document_id in (select id from public.partner_legal_documents where partner_id in ('${partnerId}', '${HOUSE_PARTNER_ID}'))`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.partner_legal_documents where partner_id = '${HOUSE_PARTNER_ID}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.partners where id = '${partnerId}'`,
      );
    }

    let documentId = "";
    // Audit events are append-only: count only those of this run.
    const startedAt = new Date().toISOString();
    const auditCount = async (action: string) => {
      const rows = await admin.$queryRawUnsafe<{ count: bigint }[]>(
        `select count(*) from public.audit_events where action = '${action}' and resource_id = '${partnerId}' and occurred_at >= '${startedAt}'`,
      );
      return Number(rows[0]!.count);
    };

    beforeAll(async () => {
      await cleanup();
      await admin.$executeRawUnsafe(
        `insert into public.partners (id, slug, name) values ('${partnerId}', 'agencia-i5', 'Agência I5')`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.partner_members (partner_id, user_id, email, role) values
          ('${partnerId}', '${partnerOwner}', 'owner@i5.test', 'partner_owner'),
          ('${partnerId}', '${partnerFinance}', 'fin@i5.test', 'partner_finance')`,
      );
      await asUser(partnerOwner, (tx) =>
        publishLegalDocument(tx, owner, partnerId, {
          kind: "terms",
          title: "Termos",
          body: "Texto original",
          requiresAcceptance: true,
        }),
      );
      const [row] = await admin.$queryRawUnsafe<{ id: string }[]>(
        `select id from public.partner_legal_documents where partner_id = '${partnerId}'`,
      );
      documentId = row!.id;
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await admin.$disconnect();
    });

    it("saves, lists and replaces the manual translation of a version", async () => {
      const languages = await asUser(partnerOwner, (tx) =>
        legalTranslationLanguages(tx),
      );
      expect(languages.map((l) => l.code)).toEqual(
        expect.arrayContaining(["pt-BR", "en", "es"]),
      );

      await asUser(partnerOwner, (tx) =>
        saveLegalTranslation(tx, owner, partnerId, documentId, "en", {
          title: "Terms",
          body: "Original text",
        }),
      );
      const saved = await asUser(partnerOwner, (tx) =>
        saveLegalTranslation(tx, owner, partnerId, documentId, "en", {
          title: " Terms ",
          body: "Revised text",
        }),
      );
      expect(saved).toMatchObject({
        locale: "en",
        title: "Terms",
        body: "Revised text",
        origin: "manual",
      });
      const listed = await asUser(partnerOwner, (tx) =>
        listLegalTranslations(tx, documentId),
      );
      expect(listed.map((t) => [t.locale, t.body])).toEqual([
        ["en", "Revised text"],
      ]);

      expect(await auditCount("legal.translation.save")).toBe(2);
    });

    it("refuses the language of the original, unknown languages and blank texts", async () => {
      const save = (locale: string, title = "T", body = "B") =>
        asUser(partnerOwner, (tx) =>
          saveLegalTranslation(tx, owner, partnerId, documentId, locale, {
            title,
            body,
          }),
        );
      await expect(save("pt-BR")).rejects.toSatisfy(
        withKey("invalid_input", "legal.errors.originalLocale"),
      );
      await expect(save("fr")).rejects.toSatisfy(
        withKey("invalid_input", "legal.errors.unknownLocale"),
      );
      await expect(save("not a locale")).rejects.toSatisfy(
        withKey("invalid_input", "legal.errors.unknownLocale"),
      );
      await expect(save("es", " ")).rejects.toSatisfy(
        withKey("invalid_input", "legal.errors.titleRequired"),
      );
      await expect(save("es", "T", " ")).rejects.toSatisfy(
        withKey("invalid_input", "legal.errors.bodyRequired"),
      );
      await expect(
        asUser(partnerOwner, (tx) =>
          saveLegalTranslation(
            tx,
            owner,
            partnerId,
            "00000000-0000-4000-8000-0000000000aa",
            "es",
            { title: "T", body: "B" },
          ),
        ),
      ).rejects.toSatisfy(withKey("not_found", "legal.errors.notFound"));
    });

    it("lets only publishers of the partner write", async () => {
      await expect(
        asUser(partnerFinance, (tx) =>
          saveLegalTranslation(
            tx,
            { userId: partnerFinance, partnerRole: "partner_finance" },
            partnerId,
            documentId,
            "es",
            { title: "Términos", body: "Texto" },
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        asUser(ids.userA, (tx) =>
          deleteLegalTranslation(
            tx,
            { userId: ids.userA },
            partnerId,
            documentId,
            "en",
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      // A role claimed by the caller is not enough: RLS checks membership.
      await expect(
        asUser(outsider, (tx) =>
          saveLegalTranslation(
            tx,
            { userId: outsider, partnerRole: "partner_owner" },
            partnerId,
            documentId,
            "es",
            { title: "Términos", body: "Texto" },
          ),
        ),
      ).rejects.toThrow();
      // Another partner's context does not even see the version.
      await expect(
        asUser(
          platformOwner,
          (tx) =>
            saveLegalTranslation(
              tx,
              { userId: platformOwner, platformRole: "owner" },
              partnerId,
              documentId,
              "es",
              { title: "Términos", body: "Texto" },
            ),
          HOUSE_PARTNER_ID,
        ),
      ).rejects.toSatisfy(withKey("not_found", "legal.errors.notFound"));
    });

    it("shows readers their language and falls back to the original", async () => {
      const read = (locale: string) =>
        withPartnerContext(prisma, partnerId, (tx) =>
          latestLocalizedLegalDocument(tx, partnerId, "terms", locale),
        );
      expect(await read("en")).toMatchObject({
        title: "Terms",
        body: "Revised text",
        translated: true,
        shownLocale: "en",
        origin: "manual",
        locale: "pt-BR",
      });
      expect(await read("es")).toMatchObject({
        title: "Termos",
        body: "Texto original",
        translated: false,
        shownLocale: "pt-BR",
      });
      expect(await read("pt-BR")).toMatchObject({ translated: false });

      // Pending documents of a customer, in English; acceptance is per version.
      const pending = await asUser(ids.userB, async (tx) =>
        localizeLegalDocuments(
          tx,
          await pendingLegalDocuments(tx, partnerId, ids.userB),
          "en",
        ),
      );
      expect(pending.map((d) => [d.id, d.title, d.translated])).toEqual([
        [documentId, "Terms", true],
      ]);

      // Another partner's host reads nothing of this partner.
      const foreign = await withPartnerContext(prisma, HOUSE_PARTNER_ID, (tx) =>
        listLegalTranslations(tx, documentId),
      );
      expect(foreign).toEqual([]);
    });

    it("removes a translation and readers see the original again", async () => {
      expect(
        await asUser(partnerOwner, (tx) =>
          deleteLegalTranslation(tx, owner, partnerId, documentId, "en"),
        ),
      ).toBe(true);
      expect(
        await asUser(partnerOwner, (tx) =>
          deleteLegalTranslation(tx, owner, partnerId, documentId, "en"),
        ),
      ).toBe(false);
      const document = await withPartnerContext(prisma, partnerId, (tx) =>
        latestLocalizedLegalDocument(tx, partnerId, "terms", "en"),
      );
      expect(document).toMatchObject({ title: "Termos", translated: false });
      expect(await auditCount("legal.translation.delete")).toBe(1);
    });

    it("publishes an original in another language and translates it into pt-BR", async () => {
      const platform: LegalPublisher = {
        userId: platformOwner,
        platformRole: "owner",
      };
      await asUser(
        platformOwner,
        (tx) =>
          publishLegalDocument(tx, platform, HOUSE_PARTNER_ID, {
            kind: "privacy",
            title: "Privacy",
            body: "English original",
            requiresAcceptance: true,
            locale: "en",
          }),
        HOUSE_PARTNER_ID,
      );
      const original = await withPartnerContext(
        prisma,
        HOUSE_PARTNER_ID,
        (tx) =>
          latestLocalizedLegalDocument(tx, HOUSE_PARTNER_ID, "privacy", "en"),
      );
      expect(original).toMatchObject({ locale: "en", translated: false });
      await asUser(
        platformOwner,
        (tx) =>
          saveLegalTranslation(
            tx,
            platform,
            HOUSE_PARTNER_ID,
            original!.id,
            "pt-BR",
            { title: "Privacidade", body: "Tradução" },
          ),
        HOUSE_PARTNER_ID,
      );
      await expect(
        asUser(
          platformOwner,
          (tx) =>
            saveLegalTranslation(
              tx,
              platform,
              HOUSE_PARTNER_ID,
              original!.id,
              "en",
              { title: "Privacy", body: "Again" },
            ),
          HOUSE_PARTNER_ID,
        ),
      ).rejects.toSatisfy(
        withKey("invalid_input", "legal.errors.originalLocale"),
      );
      const inPortuguese = await withPartnerContext(
        prisma,
        HOUSE_PARTNER_ID,
        (tx) =>
          latestLocalizedLegalDocument(
            tx,
            HOUSE_PARTNER_ID,
            "privacy",
            "pt-BR",
          ),
      );
      expect(inPortuguese).toMatchObject({
        title: "Privacidade",
        translated: true,
      });
    });
  },
);
