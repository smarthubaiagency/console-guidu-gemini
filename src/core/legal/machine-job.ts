import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import {
  requireTranslator,
  WORKER_AUDIT_CONTEXT,
} from "@/core/i18n/machine/texts-job";
import {
  type MachineTranslator,
  TranslationIncompleteError,
} from "@/core/i18n/machine/types";
import { acceptMachineDocument } from "@/core/i18n/machine/validate";
import { definePlatformJob } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * Job `legal.translate-document` (I6): fills the missing translations of one
 * legal document version, one provider call per active language other than
 * the original's, with origin `machine`. Runs as app_worker (platform job)
 * through narrow policies: it reads the version and the languages already
 * translated, and inserts only new rows, so a manual translation (or one
 * saved while the job ran) is never overwritten. Worker-safe: no React, no
 * request APIs.
 */

export const TRANSLATE_DOCUMENT_KIND = "legal.translate-document";

export const TranslateDocumentPayload = z
  .object({
    documentId: z.string().uuid(),
    partnerId: z.string().uuid(),
    requestedBy: z.string().uuid(),
  })
  .strict();
export type TranslateDocumentPayload = z.infer<typeof TranslateDocumentPayload>;

export type TranslateDocumentResult = {
  documentId: string;
  provider: string;
  missing: number;
  translated: number;
  invalid: number;
  skipped: number;
};

export async function translateMissingDocument(
  tx: ContextTransaction,
  payload: TranslateDocumentPayload,
  translator: MachineTranslator,
): Promise<TranslateDocumentResult> {
  const document = await tx.partnerLegalDocument.findFirst({
    where: { id: payload.documentId, partnerId: payload.partnerId },
    select: {
      id: true,
      kind: true,
      version: true,
      title: true,
      body: true,
      locale: true,
    },
  });
  if (!document) throw new SkipJobError("Documento não encontrado.");

  const [active, original, existing] = await Promise.all([
    tx.$queryRaw<{ code: string; name: string }[]>`
      select code, name from private.ui_languages()
    `,
    tx.platformLanguage.findUnique({
      where: { code: document.locale },
      select: { code: true, name: true },
    }),
    tx.partnerLegalDocumentTranslation.findMany({
      where: { documentId: document.id },
      select: { locale: true },
    }),
  ]);
  const done = new Set(existing.map((row) => row.locale));
  const targets = active.filter(
    (l) => l.code !== document.locale && !done.has(l.code),
  );
  const source = original ?? { code: document.locale, name: document.locale };

  const result: TranslateDocumentResult = {
    documentId: document.id,
    provider: translator.provider,
    missing: targets.length,
    translated: 0,
    invalid: 0,
    skipped: 0,
  };
  // One language at a time: a document may be long (up to 100k chars).
  for (const target of targets) {
    let output;
    try {
      output = await translator.translateDocument(source, target, {
        title: document.title,
        body: document.body,
      });
    } catch (error) {
      if (error instanceof TranslationIncompleteError) {
        result.skipped += 1;
        continue;
      }
      throw error;
    }
    const accepted = acceptMachineDocument(output);
    if (!accepted) {
      result.invalid += 1;
      continue;
    }
    result.translated += await tx.$executeRaw`
      insert into public.partner_legal_document_translations
        (document_id, locale, title, body, origin)
      values (${document.id}::uuid, ${target.code}, ${accepted.title},
              ${accepted.body}, 'machine')
      on conflict do nothing
    `;
  }

  await recordAudit(tx, WORKER_AUDIT_CONTEXT, {
    action: "legal.translation.machine",
    resourceType: "partner_legal_document",
    resourceId: payload.partnerId,
    result: "success",
    origin: "worker",
    metadata: {
      target: `${document.kind}@${document.version}`,
      provider: result.provider,
      status: "succeeded",
      translated: result.translated,
      invalid: result.invalid,
      skipped: result.skipped,
    },
  });
  return result;
}

export const translateDocumentJob = definePlatformJob<TranslateDocumentPayload>(
  {
    kind: TRANSLATE_DOCUMENT_KIND,
    description:
      "Tradução automática de uma versão de termos ou privacidade para os idiomas que faltam (I6).",
    payload: TranslateDocumentPayload,
    maxAttempts: 3,
    retryDelaySeconds: 60,
    // One streamed call per language; a long document takes minutes.
    expireInSeconds: 3600,
    run: async (tx, payload) =>
      translateMissingDocument(tx, payload, await requireTranslator()),
  },
);
