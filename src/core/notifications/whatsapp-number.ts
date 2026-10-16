import { recordAudit } from "@/core/audit/record";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

/**
 * Minha conta › "Meu WhatsApp" (H2): the person's own number, kept in
 * E.164, and when they accepted the notices on it. Without both the hub
 * never sends them a WhatsApp (the delivery is kept as skipped with the
 * reason). Only the person reads and writes it (RLS); the hub reads it
 * through its own functions while it tells an event's audience.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes a number typed by a person to E.164. A number without a
 * country code is read as Brazilian (10 or 11 digits with the area code).
 * Null when it cannot be a phone number.
 */
export function normalizeE164(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 32 || /[^\d\s()+.-]/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  } else if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = `55${digits.slice(1)}`;
  }
  const phone = `+${digits}`;
  return E164.test(phone) ? phone : null;
}

export type MyWhatsapp = Readonly<{ phone: string; consentedAt: Date }>;

export async function myWhatsapp(
  tx: ContextTransaction,
  userId: string,
): Promise<MyWhatsapp | null> {
  const [row] = await tx.$queryRaw<{ phone: string; consented_at: Date }[]>`
    select phone, consented_at from public.user_whatsapp_numbers
    where user_id = ${userId}::uuid
  `;
  return row ? { phone: row.phone, consentedAt: row.consented_at } : null;
}

function invalid(key: string, message: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `eventRules.whatsapp.errors.${key}`,
  });
}

/** Saves the number with the explicit acceptance (now). */
export async function saveMyWhatsapp(
  tx: ContextTransaction,
  userId: string,
  input: Readonly<{ phone: string; consent: boolean }>,
): Promise<MyWhatsapp> {
  const phone = normalizeE164(input.phone);
  if (!phone) throw invalid("phone", "Número de WhatsApp inválido.");
  if (!input.consent) {
    throw invalid("consent", "Marque o aceite para receber avisos por WhatsApp.");
  }
  await tx.$executeRaw`
    insert into public.user_whatsapp_numbers (user_id, phone, consented_at)
    values (${userId}::uuid, ${phone}, now())
    on conflict (user_id) do update set phone = excluded.phone, consented_at = excluded.consented_at
  `;
  await recordAudit(
    tx,
    { userId, workspaceId: "", organizationId: "" },
    {
      action: "account.whatsapp.save",
      resourceType: "user_whatsapp_number",
      resourceId: userId,
      result: "success",
      origin: "app",
      metadata: {},
    },
  );
  return (await myWhatsapp(tx, userId))!;
}

/** Removes the number (and the acceptance with it). */
export async function removeMyWhatsapp(
  tx: ContextTransaction,
  userId: string,
): Promise<boolean> {
  const removed = await tx.$executeRaw`
    delete from public.user_whatsapp_numbers where user_id = ${userId}::uuid
  `;
  if (removed > 0) {
    await recordAudit(
      tx,
      { userId, workspaceId: "", organizationId: "" },
      {
        action: "account.whatsapp.remove",
        resourceType: "user_whatsapp_number",
        resourceId: userId,
        result: "success",
        origin: "app",
        metadata: {},
      },
    );
  }
  return removed > 0;
}
