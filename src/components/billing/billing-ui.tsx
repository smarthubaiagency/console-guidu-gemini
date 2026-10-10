import {
  statusLabel,
  type SubscriptionStatus,
} from "@/core/billing/subscriptions";

/** Visual helpers shared by the billing pages (P5m). */

const TONES: Record<SubscriptionStatus, string> = {
  pending: "bg-info-bg text-info-text border-info-border",
  active: "bg-success-bg text-success-text border-success-border",
  past_due: "bg-warning-bg text-warning-text border-warning-border",
  suspended: "bg-danger-bg text-danger-text border-danger-border",
  canceled: "border-border text-text-secondary",
};

export function SubscriptionBadge({
  status,
}: Readonly<{ status: SubscriptionStatus }>) {
  return (
    <span
      className={`text-11 rounded-full border px-2 py-0.5 font-semibold ${TONES[status]}`}
      data-testid="subscription-status"
    >
      {statusLabel(status)}
    </span>
  );
}

/** Values the Commercial team has not confirmed yet (D-PA-11). */
export function ProvisionalBadge() {
  return (
    <span className="bg-warning-bg text-warning-text border-warning-border text-11 rounded-full border px-2 py-0.5 font-semibold">
      Provisório
    </span>
  );
}

/** Calendar dates are stored at midnight UTC. */
export function formatDate(date: Date | null | undefined): string {
  return date ? date.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";
}

/** Today in the yyyy-mm-dd form of date inputs. */
export function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Cents as the "99,90" text the reais inputs accept. */
export function centsInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function intervalLabel(interval: string): string {
  return interval === "yearly" ? "ano" : "mês";
}

export const METHOD_LABELS: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  transfer: "Transferência",
  card: "Cartão",
  other: "Outro",
};

export const sectionClass =
  "border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs";
