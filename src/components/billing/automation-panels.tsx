import { formatDate, sectionClass } from "@/components/billing/billing-ui";
import {
  deliveryStatusLabel,
  type NotificationDeliveryView,
  noticeLabel,
  type PayoutReportView,
} from "@/core/billing/operations";
import { formatCents } from "@/core/billing/split";

/** Payout reports and notices of the billing jobs (F3c). */

function monthLabel(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function PayoutReportsSection({
  reports,
  showPartner,
}: Readonly<{ reports: readonly PayoutReportView[]; showPartner: boolean }>) {
  return (
    <section className={sectionClass}>
      <h2 className="text-14 text-text font-semibold">Relatórios de repasse</h2>
      <p className="text-12 text-text-secondary">
        Gerados no início de cada mês para o mês fechado, com os pagamentos e
        estornos registrados nele. Um relatório gerado não muda depois.
      </p>
      <ul className="divide-border divide-y" data-testid="payout-reports">
        {reports.map((r) => (
          <li key={r.id} className="text-12 text-text-secondary py-2">
            <span className="text-text font-semibold">
              {monthLabel(r.periodStart)}
            </span>
            {showPartner ? ` · ${r.partnerName}` : ""} · {r.paymentsCount}{" "}
            pagamento(s) · recebido {formatCents(r.receivedCents)} · estornado{" "}
            {formatCents(r.refundedCents)} · plataforma{" "}
            {formatCents(r.platformNetCents)} · parceiro{" "}
            {formatCents(r.partnerNetCents)} · gerado em{" "}
            {formatDate(r.generatedAt)}
          </li>
        ))}
        {reports.length === 0 ? (
          <li className="text-12 text-text-secondary py-2">Sem dados.</li>
        ) : null}
      </ul>
    </section>
  );
}

export function NoticesSection({
  notices,
  showPartner,
}: Readonly<{
  notices: readonly NotificationDeliveryView[];
  showPartner: boolean;
}>) {
  return (
    <section className={sectionClass}>
      <h2 className="text-14 text-text font-semibold">Avisos de cobrança</h2>
      <p className="text-12 text-text-secondary">
        Avisos ao parceiro quando uma assinatura entra em atraso ou é suspensa.
        O envio de e-mail está desligado até a escolha do provedor; os avisos
        ficam registrados aqui.
      </p>
      <ul className="divide-border divide-y" data-testid="billing-notices">
        {notices.map((n) => (
          <li key={n.id} className="text-12 text-text-secondary py-2">
            <span className="text-text font-semibold">
              {noticeLabel(n.eventType)}
            </span>
            {showPartner ? ` · ${n.partnerName}` : ""} · {n.subject} · para{" "}
            {n.recipientEmail} · {deliveryStatusLabel(n.status, n.reason)} ·{" "}
            {formatDate(n.createdAt)}
          </li>
        ))}
        {notices.length === 0 ? (
          <li className="text-12 text-text-secondary py-2">
            Nenhum aviso registrado.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
