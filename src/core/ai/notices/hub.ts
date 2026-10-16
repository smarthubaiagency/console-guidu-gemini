import type { ContextTransaction } from "@/lib/prisma/with-context";

/**
 * The GUIDS notices (A6) delivered by the Event Hub (H1): the outcome of
 * the WhatsApp delivery goes back to `ai_lead_notices`, so the lead log of
 * the panel keeps showing each notice's state. Runs in the dispatch, as
 * app_worker, which updates only the state columns of that table.
 */

export const LEAD_NOTICE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "ai.agent.lead_hot",
  "ai.agent.referral_recommended",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function recordLeadNoticeOutcome(
  tx: ContextTransaction,
  data: Readonly<Record<string, unknown>>,
  outcome: Readonly<{
    status: "sent" | "skipped" | "failed";
    reason: string | null;
    attempts: number;
    at: Date;
  }>,
): Promise<void> {
  const noticeId = typeof data.noticeId === "string" ? data.noticeId : "";
  if (!UUID.test(noticeId)) return;
  await tx.$executeRaw`
    update public.ai_lead_notices
    set status = ${outcome.status},
        reason = ${outcome.reason?.slice(0, 80) ?? null},
        attempts = greatest(attempts, ${outcome.attempts}),
        sent_at = ${outcome.status === "sent" ? outcome.at : null}
    where id = ${noticeId}::uuid and status <> 'sent'
  `;
}
