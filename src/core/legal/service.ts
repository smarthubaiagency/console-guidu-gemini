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

/**
 * Terms and privacy policy per partner (ADR 0012, P4b2; especificação §5).
 * Versions are insert-only. A version that `requiresAcceptance` (always the
 * first) must be accepted by users of the partner's hosts before they use
 * /app; a later version without it keeps the previous acceptance valid.
 * Run with the partner of the request host in context.
 */

export const LEGAL_KINDS = ["terms", "privacy"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export const LEGAL_KIND_LABELS: Record<LegalKind, string> = {
  terms: "Termos de uso",
  privacy: "Política de privacidade",
};

export type LegalDocumentView = Readonly<{
  id: string;
  kind: LegalKind;
  version: number;
  title: string;
  body: string;
  requiresAcceptance: boolean;
  publishedAt: Date;
}>;

function toView(row: {
  id: string;
  kind: string;
  version: number;
  title: string;
  body: string;
  requiresAcceptance: boolean;
  publishedAt: Date;
}): LegalDocumentView {
  return { ...row, kind: row.kind as LegalKind };
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
  for (const kind of LEGAL_KINDS) {
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

function canPublish(actor: LegalPublisher): boolean {
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
});

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
  }>,
): Promise<{ version: number }> {
  if (!canPublish(actor)) throw new PermissionDeniedError();
  const parsed = PublishSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    });
  }

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
