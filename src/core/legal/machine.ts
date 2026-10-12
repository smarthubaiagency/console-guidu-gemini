import { recordAudit } from "@/core/audit/record";
import { notConfigured } from "@/core/i18n/machine/requests";
import { machineTranslationProvider } from "@/core/i18n/machine/provider";
import { MAX_LEGAL_BODY } from "@/core/i18n/machine/validate";
import {
  enqueuePlatformJob,
  type PlatformRunView,
  platformRunSelect,
  toPlatformRunView,
} from "@/core/jobs/service";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { TRANSLATE_DOCUMENT_KIND, translateDocumentJob } from "./machine-job";
import { canPublishLegal, type LegalPublisher } from "./service";

/**
 * Web side of the machine translation of legal documents (I6): per version,
 * "Traduzir automaticamente" queues a run that fills the missing
 * translations (active languages other than the original's) with origin
 * `machine`. Same publishers as the versions.
 */

export async function requestLegalTranslation(
  tx: ContextTransaction,
  actor: LegalPublisher,
  partnerId: string,
  documentId: string,
): Promise<{ id: string }> {
  if (!canPublishLegal(actor)) throw new PermissionDeniedError();
  const provider = machineTranslationProvider();
  if (!provider) throw notConfigured();
  const document = await tx.partnerLegalDocument.findFirst({
    where: { id: documentId, partnerId },
    select: { id: true, kind: true, version: true, body: true },
  });
  if (!document) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Recurso não encontrado.",
      messageKey: "legal.errors.notFound",
    });
  }
  if (document.body.length > MAX_LEGAL_BODY) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Documento longo demais para a tradução automática.",
      messageKey: "legal.machine.tooLong",
    });
  }
  const run = await enqueuePlatformJob(
    tx,
    actor.userId,
    translateDocumentJob,
    { documentId, partnerId, requestedBy: actor.userId },
    { partnerId, subjectField: "documentId" },
  );
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "legal.translation.machine_request",
    resourceType: "partner_legal_document",
    resourceId: partnerId,
    result: "success",
    origin: actor.platformRole ? "admin" : "app",
    metadata: { target: `${document.kind}@${document.version}`, provider },
  });
  return run;
}

/** Latest machine translation run of each version of a partner. */
export async function latestLegalTranslationRuns(
  tx: ContextTransaction,
  partnerId: string,
): Promise<Record<string, PlatformRunView>> {
  const rows = await tx.jobRun.findMany({
    where: { kind: TRANSLATE_DOCUMENT_KIND, partnerId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: platformRunSelect,
  });
  const out: Record<string, PlatformRunView> = {};
  for (const row of rows) {
    const view = toPlatformRunView(row);
    const id = view.payload.documentId;
    if (typeof id === "string" && !(id in out)) out[id] = view;
  }
  return out;
}
