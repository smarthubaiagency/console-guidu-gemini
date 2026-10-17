import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
  type PartnerRoleKey,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";
import { LOCALE_CODE, SOURCE_LOCALE } from "@/core/i18n/locales";

/**
 * Terms and privacy policy per partner (ADR 0012, P4b2; especificação §5).
 * Versions are insert-only. A version that `requiresAcceptance` (always the
 * first) must be accepted by users of the partner's hosts before they use
 * /app; a later version without it keeps the previous acceptance valid.
 * Run with the partner of the request host in context.
 */

/**
 * `management`: the management clause (GB1c, ADR 0020), accepted on first
 * access only by owners of a company registered as managed by the partner
 * of the host (`private.management_clause_required`).
 */
export const LEGAL_KINDS = ["terms", "privacy", "management"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export const LEGAL_KIND_LABELS: Record<LegalKind, string> = {
  terms: "Termos de uso",
  privacy: "Política de privacidade",
  management: "Cláusula de gerenciamento",
};

/** True when the person of the context must accept the management clause. */
async function managementClauseRequired(
  tx: ContextTransaction,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ required: boolean }[]>`
    select private.management_clause_required() as required
  `;
  return row?.required === true;
}

export type LegalDocumentView = Readonly<{
  id: string;
  kind: LegalKind;
  version: number;
  title: string;
  body: string;
  requiresAcceptance: boolean;
  publishedAt: Date;
  /** Language of the original text (I5). */
  locale: string;
}>;

function toView(row: {
  id: string;
  kind: string;
  version: number;
  title: string;
  body: string;
  requiresAcceptance: boolean;
  publishedAt: Date;
  locale: string;
}): LegalDocumentView {
  return {
    id: row.id,
    kind: row.kind as LegalKind,
    version: row.version,
    title: row.title,
    body: row.body,
    requiresAcceptance: row.requiresAcceptance,
    publishedAt: row.publishedAt,
    locale: row.locale,
  };
}

export async function listLegalDocuments(
  tx: ContextTransaction,
  partnerId: string,
): Promise<LegalDocumentView[]> {
  const rows = await tx.partnerLegalDocument.findMany({
    where: { partnerId },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
  });
  return rows.map(toView);
}

/** Latest version of one kind, or null when none is published. */
export async function latestLegalDocument(
  tx: ContextTransaction,
  partnerId: string,
  kind: LegalKind,
): Promise<LegalDocumentView | null> {
  const row = await tx.partnerLegalDocument.findFirst({
    where: { partnerId, kind },
    orderBy: { version: "desc" },
  });
  return row ? toView(row) : null;
}

/**
 * Latest versions the user still has to accept: for each kind, the newest
 * version requiring acceptance must be accepted, or any later version.
 */
export async function pendingLegalDocuments(
  tx: ContextTransaction,
  partnerId: string,
  userId: string,
): Promise<LegalDocumentView[]> {
  const docs = await listLegalDocuments(tx, partnerId);
  if (docs.length === 0) return [];
  const accepted = new Set(
    (
      await tx.legalAcceptance.findMany({
        where: { userId, documentId: { in: docs.map((d) => d.id) } },
        select: { documentId: true },
      })
    ).map((a) => a.documentId),
  );

  const pending: LegalDocumentView[] = [];
  const kinds = docs.some((d) => d.kind === "management")
    ? (await managementClauseRequired(tx))
      ? LEGAL_KINDS
      : LEGAL_KINDS.filter((kind) => kind !== "management")
    : LEGAL_KINDS;
  for (const kind of kinds) {
    const versions = docs.filter((d) => d.kind === kind); // newest first
    const required = versions.find((d) => d.requiresAcceptance);
    if (!required) continue;
    const satisfied = versions.some(
      (d) => d.version >= required.version && accepted.has(d.id),
    );
    if (!satisfied) pending.push(versions[0]!);
  }
  return pending;
}

/** Records acceptance of the documents still pending (computed here). */
export async function acceptPendingLegalDocuments(
  tx: ContextTransaction,
  partnerId: string,
  userId: string,
): Promise<number> {
  const pending = await pendingLegalDocuments(tx, partnerId, userId);
  if (pending.length === 0) return 0;
  await tx.legalAcceptance.createMany({
    data: pending.map((d) => ({ userId, documentId: d.id })),
    skipDuplicates: true,
  });
  await recordAudit(tx, adminAuditContext(userId), {
    action: "legal.accept",
    resourceType: "partner_legal_document",
    resourceId: partnerId,
    result: "success",
    origin: "app",
    metadata: {
      target: pending.map((d) => `${d.kind}@${d.version}`).join(","),
    },
  });
  return pending.length;
}

export type LegalPublisher = Readonly<{
  userId: string;
  platformRole?: PlatformAdminRoleKey | null;
  partnerRole?: PartnerRoleKey | null;
}>;

/** Platform owner/operations or partner owner/admin (legal.manage). */
export function canPublishLegal(actor: LegalPublisher): boolean {
  return Boolean(
    (actor.platformRole &&
      hasPlatformRolePermission(
        actor.platformRole,
        Permissions.PLATFORM_LEGAL_MANAGE,
      )) ||
    (actor.partnerRole &&
      hasPartnerRolePermission(
        actor.partnerRole,
        Permissions.PARTNER_LEGAL_MANAGE,
      )),
  );
}

const PublishSchema = z.object({
  kind: z.enum(LEGAL_KINDS),
  title: z.string().trim().min(1, "Informe o título.").max(120),
  body: z.string().trim().min(1, "Informe o texto.").max(100_000),
  requiresAcceptance: z.boolean(),
  locale: z.string().regex(LOCALE_CODE).optional(),
});

/** Message key of the first validation issue (Portuguese stays the fallback). */
function publishIssueKey(
  issue: z.core.$ZodIssue | undefined,
): string | undefined {
  if (!issue) return "legal.errors.invalidInput";
  if (issue.code !== "too_small") return undefined;
  if (issue.path[0] === "title") return "legal.errors.titleRequired";
  if (issue.path[0] === "body") return "legal.errors.bodyRequired";
  return undefined;
}

/** Publishes the next version of a document for the context partner. */
export async function publishLegalDocument(
  tx: ContextTransaction,
  actor: LegalPublisher,
  partnerId: string,
  input: Readonly<{
    kind: string;
    title: string;
    body: string;
    requiresAcceptance: boolean;
    /** Language of the original; the source language when omitted. */
    locale?: string;
  }>,
): Promise<{ version: number }> {
  if (!canPublishLegal(actor)) throw new PermissionDeniedError();
  const parsed = PublishSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const messageKey = publishIssueKey(issue);
    throw new AppError({
      code: "invalid_input",
      safeMessage: issue?.message ?? "Dados inválidos.",
      ...(messageKey ? { messageKey } : {}),
    });
  }

  const locale = parsed.data.locale ?? SOURCE_LOCALE;
  if (locale !== SOURCE_LOCALE) await requireLegalLanguage(tx, locale);

  await tx.$executeRaw`
    select pg_advisory_xact_lock(hashtext('partner_legal:' || ${partnerId}::text || ':' || ${parsed.data.kind}))
  `;
  const current = await latestLegalDocument(tx, partnerId, parsed.data.kind);
  const version = (current?.version ?? 0) + 1;
  // The first version always requires acceptance (also a CHECK in SQL).
  const requiresAcceptance = version === 1 || parsed.data.requiresAcceptance;

  await tx.partnerLegalDocument.create({
    data: {
      partnerId,
      kind: parsed.data.kind,
      version,
      title: parsed.data.title,
      body: parsed.data.body,
      requiresAcceptance,
      locale,
      publishedBy: actor.userId,
    },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "legal.publish",
    resourceType: "partner_legal_document",
    resourceId: partnerId,
    result: "success",
    origin: actor.platformRole ? "admin" : "app",
    metadata: {
      target: parsed.data.kind,
      to: String(version),
      reason: requiresAcceptance ? "requires_acceptance" : "no_reacceptance",
    },
  });
  return { version };
}

// ---------------------------------------------------------------------------
// Translations per dashboard language (I5, ADR 0013)
//
// Each published version may have one translation per platform language
// other than the language of its original, edited in the legal settings
// (origin `manual`) or filled by machine translation (`machine`, I6).
// Readers see the translation of their language and fall back to the
// original, which prevails. Acceptance stays per version.
// ---------------------------------------------------------------------------

export type LegalTranslationOrigin = "manual" | "machine";

export type LegalTranslationView = Readonly<{
  documentId: string;
  locale: string;
  title: string;
  body: string;
  origin: LegalTranslationOrigin;
  updatedAt: Date;
}>;

export type LegalLanguage = Readonly<{
  code: string;
  name: string;
  status: "active" | "draft";
}>;

/** A version as read in one language. */
export type LocalizedLegalDocumentView = LegalDocumentView &
  Readonly<{
    /** Language of `title` and `body`. */
    shownLocale: string;
    /** True when `title` and `body` come from a translation. */
    translated: boolean;
    origin: LegalTranslationOrigin | null;
  }>;

function toTranslationView(row: {
  documentId: string;
  locale: string;
  title: string;
  body: string;
  origin: string;
  updatedAt: Date;
}): LegalTranslationView {
  return {
    documentId: row.documentId,
    locale: row.locale,
    title: row.title,
    body: row.body,
    origin: row.origin === "machine" ? "machine" : "manual",
    updatedAt: row.updatedAt,
  };
}

/**
 * Languages a version can be translated into: the active languages (for
 * everyone) and the drafts (visible to platform staff, who prepare them).
 */
export async function legalTranslationLanguages(
  tx: ContextTransaction,
): Promise<LegalLanguage[]> {
  const [active, drafts] = await Promise.all([
    tx.$queryRaw<{ code: string; name: string }[]>`
      select code, name from private.ui_languages()
    `,
    tx.platformLanguage.findMany({
      where: { status: "draft" },
      orderBy: [{ position: "asc" }, { code: "asc" }],
      select: { code: true, name: true },
    }),
  ]);
  return [
    ...active.map((l) => ({ ...l, status: "active" as const })),
    ...drafts.map((l) => ({ ...l, status: "draft" as const })),
  ];
}

async function requireLegalLanguage(
  tx: ContextTransaction,
  locale: string,
): Promise<void> {
  const languages = await legalTranslationLanguages(tx);
  if (!languages.some((l) => l.code === locale)) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Idioma indisponível.",
      messageKey: "legal.errors.unknownLocale",
    });
  }
}

function legalNotFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
    messageKey: "legal.errors.notFound",
  });
}

/** Translations of one version, by language. */
export async function listLegalTranslations(
  tx: ContextTransaction,
  documentId: string,
): Promise<LegalTranslationView[]> {
  const rows = await tx.partnerLegalDocumentTranslation.findMany({
    where: { documentId },
    orderBy: { locale: "asc" },
  });
  return rows.map(toTranslationView);
}

/** Translations of every version of a partner (legal settings). */
export async function listPartnerLegalTranslations(
  tx: ContextTransaction,
  partnerId: string,
): Promise<LegalTranslationView[]> {
  const rows = await tx.partnerLegalDocumentTranslation.findMany({
    where: { document: { partnerId } },
    orderBy: [{ documentId: "asc" }, { locale: "asc" }],
  });
  return rows.map(toTranslationView);
}

const TranslationSchema = z.object({
  locale: z.string().regex(LOCALE_CODE),
  title: z.string().trim().min(1, "Informe o título.").max(120),
  body: z.string().trim().min(1, "Informe o texto.").max(100_000),
});

async function translatableDocument(
  tx: ContextTransaction,
  partnerId: string,
  documentId: string,
) {
  const document = await tx.partnerLegalDocument.findFirst({
    where: { id: documentId, partnerId },
    select: { id: true, kind: true, version: true, locale: true },
  });
  if (!document) throw legalNotFound();
  return document;
}

/** Creates or replaces the manual translation of a version. */
export async function saveLegalTranslation(
  tx: ContextTransaction,
  actor: LegalPublisher,
  partnerId: string,
  documentId: string,
  locale: string,
  input: Readonly<{ title: string; body: string }>,
): Promise<LegalTranslationView> {
  if (!canPublishLegal(actor)) throw new PermissionDeniedError();
  const parsed = TranslationSchema.safeParse({ ...input, locale });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const messageKey =
      issue?.path[0] === "locale"
        ? "legal.errors.unknownLocale"
        : publishIssueKey(issue);
    throw new AppError({
      code: "invalid_input",
      safeMessage: issue?.message ?? "Dados inválidos.",
      ...(messageKey ? { messageKey } : {}),
    });
  }
  const document = await translatableDocument(tx, partnerId, documentId);
  if (parsed.data.locale === document.locale) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Este é o idioma do original.",
      messageKey: "legal.errors.originalLocale",
    });
  }
  await requireLegalLanguage(tx, parsed.data.locale);

  const data = {
    title: parsed.data.title,
    body: parsed.data.body,
    origin: "manual",
    updatedBy: actor.userId,
  };
  const row = await tx.partnerLegalDocumentTranslation.upsert({
    where: {
      documentId_locale: { documentId, locale: parsed.data.locale },
    },
    create: { documentId, locale: parsed.data.locale, ...data },
    update: data,
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "legal.translation.save",
    resourceType: "partner_legal_document",
    resourceId: partnerId,
    result: "success",
    origin: actor.platformRole ? "admin" : "app",
    metadata: {
      target: `${document.kind}@${document.version}`,
      to: parsed.data.locale,
      reason: "manual",
    },
  });
  return toTranslationView(row);
}

/** Removes the translation of a version; readers see the original again. */
export async function deleteLegalTranslation(
  tx: ContextTransaction,
  actor: LegalPublisher,
  partnerId: string,
  documentId: string,
  locale: string,
): Promise<boolean> {
  if (!canPublishLegal(actor)) throw new PermissionDeniedError();
  const document = await translatableDocument(tx, partnerId, documentId);
  const { count } = await tx.partnerLegalDocumentTranslation.deleteMany({
    where: { documentId, locale },
  });
  if (count === 0) return false;
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "legal.translation.delete",
    resourceType: "partner_legal_document",
    resourceId: partnerId,
    result: "success",
    origin: actor.platformRole ? "admin" : "app",
    metadata: {
      target: `${document.kind}@${document.version}`,
      from: locale,
    },
  });
  return true;
}

/**
 * Versions as read in `locale`: the translation of that language when it
 * exists, else the original.
 */
export async function localizeLegalDocuments(
  tx: ContextTransaction,
  documents: readonly LegalDocumentView[],
  locale: string,
): Promise<LocalizedLegalDocumentView[]> {
  const wanted = documents.filter((d) => d.locale !== locale);
  const rows =
    wanted.length === 0
      ? []
      : await tx.partnerLegalDocumentTranslation.findMany({
          where: { locale, documentId: { in: wanted.map((d) => d.id) } },
        });
  return documents.map((document) => {
    const row = rows.find((r) => r.documentId === document.id);
    if (!row) {
      return {
        ...document,
        shownLocale: document.locale,
        translated: false,
        origin: null,
      };
    }
    return {
      ...document,
      title: row.title,
      body: row.body,
      shownLocale: locale,
      translated: true,
      origin: row.origin === "machine" ? "machine" : "manual",
    };
  });
}

/** Latest version of one kind as read in `locale`, or null. */
export async function latestLocalizedLegalDocument(
  tx: ContextTransaction,
  partnerId: string,
  kind: LegalKind,
  locale: string,
): Promise<LocalizedLegalDocumentView | null> {
  const document = await latestLegalDocument(tx, partnerId, kind);
  if (!document) return null;
  const [localized] = await localizeLegalDocuments(tx, [document], locale);
  return localized ?? null;
}
