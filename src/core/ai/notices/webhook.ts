import "server-only";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { encryptSecret } from "@/core/credentials/crypto";
import { ChannelHttpError, providerOrigin } from "@/core/channels/http";
import { adminAuditContext } from "@/core/module-runtime/settings";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { type PartnerKeyActor, requirePartnerKeys } from "../keys";

/**
 * The partner's webhook for the notices of its customers' GUIDS (A6a,
 * Marcelo 14/10/2026): GUIDU posts the notice, signed, and the partner's
 * flow sends the WhatsApp message from the merchant's Assistant number.
 * Partner owner and admin manage it in /admin; the secret is encrypted and
 * shown masked only. RLS repeats every check.
 */

export type NoticeWebhookDto = Readonly<{
  url: string;
  maskedSecret: string;
  enabled: boolean;
  updatedAt: string;
}>;

export const NoticeWebhookInput = z.strictObject({
  url: z.string().trim().min(10).max(2000),
  // Empty keeps the secret already saved.
  secret: z.string().trim().max(200).default(""),
  enabled: z.boolean().default(true),
});

const MIN_SECRET = 16;

function invalid(message: string): AppError {
  return new AppError({ code: "invalid_input", safeMessage: message });
}

/** The address of the webhook: https (http only in local development). */
function webhookUrl(raw: string): string {
  try {
    providerOrigin(raw);
    return new URL(raw).toString();
  } catch (error) {
    if (error instanceof ChannelHttpError || error instanceof TypeError) {
      throw invalid("Use um endereço https completo para o webhook.");
    }
    throw error;
  }
}

function toDto(row: {
  url: string;
  maskedSecret: string;
  enabled: boolean;
  updatedAt: Date;
}): NoticeWebhookDto {
  return {
    url: row.url,
    maskedSecret: row.maskedSecret,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getNoticeWebhook(
  tx: ContextTransaction,
  actor: PartnerKeyActor,
  partnerId: string,
): Promise<NoticeWebhookDto | null> {
  requirePartnerKeys(actor);
  const row = await tx.partnerNoticeWebhook.findUnique({
    where: { partnerId },
  });
  return row ? toDto(row) : null;
}

export async function saveNoticeWebhook(
  tx: ContextTransaction,
  actor: PartnerKeyActor,
  partnerId: string,
  input: unknown,
): Promise<NoticeWebhookDto> {
  requirePartnerKeys(actor);
  const parsed = NoticeWebhookInput.safeParse(input);
  if (!parsed.success) throw invalid("Dados do webhook inválidos.");
  const url = webhookUrl(parsed.data.url);
  const { secret, enabled } = parsed.data;
  if (secret && secret.length < MIN_SECRET) {
    throw invalid(`O segredo precisa de pelo menos ${MIN_SECRET} caracteres.`);
  }
  const existing = await tx.partnerNoticeWebhook.findUnique({
    where: { partnerId },
    select: { partnerId: true },
  });
  if (!existing && !secret) {
    throw invalid("Informe o segredo que assina os avisos.");
  }
  const sealed = secret ? encryptSecret(secret) : null;
  const sealedFields = sealed
    ? {
        maskedSecret: sealed.maskedValue,
        encryptedSecret: sealed.encryptedPayload,
      }
    : {};
  const row = existing
    ? await tx.partnerNoticeWebhook.update({
        where: { partnerId },
        data: { url, enabled, updatedBy: actor.userId, ...sealedFields },
      })
    : await tx.partnerNoticeWebhook.create({
        data: {
          partnerId,
          url,
          enabled,
          updatedBy: actor.userId,
          maskedSecret: sealed!.maskedValue,
          encryptedSecret: sealed!.encryptedPayload,
        },
      });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.ai_notice_webhook.save",
    resourceType: "partner_notice_webhook",
    resourceId: partnerId,
    result: "success",
    origin: "admin",
    metadata: {
      partnerId,
      origin: new URL(url).origin,
      enabled,
      secretChanged: Boolean(sealed),
    },
  });
  return toDto(row);
}

export async function removeNoticeWebhook(
  tx: ContextTransaction,
  actor: PartnerKeyActor,
  partnerId: string,
): Promise<void> {
  requirePartnerKeys(actor);
  const removed = await tx.partnerNoticeWebhook.deleteMany({
    where: { partnerId },
  });
  if (removed.count === 0) {
    throw new AppError({
      code: "not_found",
      safeMessage: "Webhook não encontrado.",
      messageKey: "apiErrors.notFound",
    });
  }
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.ai_notice_webhook.remove",
    resourceType: "partner_notice_webhook",
    resourceId: partnerId,
    result: "success",
    origin: "admin",
    metadata: { partnerId },
  });
}
