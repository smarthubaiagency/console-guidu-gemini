import type {
  NotificationBrand,
  NotificationEvent,
  RenderedMessage,
} from "./types";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Only absolute http(s) links reach a template. */
function safeLink(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Link de notificação inválido.");
  }
  return url.toString();
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function supportLines(brand: NotificationBrand): string[] {
  return [
    brand.supportEmail ? `Suporte: ${brand.supportEmail}` : null,
    brand.supportUrl ? `Ajuda: ${safeLink(brand.supportUrl)}` : null,
  ].filter((line): line is string => line !== null);
}

function layout(
  brand: NotificationBrand,
  paragraphs: readonly string[],
  action: Readonly<{ label: string; url: string }>,
): Pick<RenderedMessage, "text" | "html"> {
  const support = supportLines(brand);
  const text = [
    ...paragraphs,
    "",
    `${action.label}: ${action.url}`,
    "",
    ...support,
    `— ${brand.name}`,
  ].join("\n");

  const html = [
    `<p><strong>${escapeHtml(brand.name)}</strong></p>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`,
    ...support.map((line) => `<p><small>${escapeHtml(line)}</small></p>`),
  ].join("\n");

  return { text, html };
}

/** Renders an event with the partner brand; all values are escaped. */
export function renderNotification(
  event: NotificationEvent,
  brand: NotificationBrand,
): RenderedMessage {
  switch (event.type) {
    case "invitation.created": {
      const url = safeLink(event.data.inviteUrl);
      return {
        subject: `Convite para ${event.data.organizationName} no ${brand.name}`,
        ...layout(
          brand,
          [
            `Você foi convidado para participar de ${event.data.organizationName} no ${brand.name}.`,
            `O convite vale até ${formatDate(event.data.expiresAt)}.`,
          ],
          { label: "Aceitar convite", url },
        ),
      };
    }
    case "billing.subscription.past_due": {
      const { data } = event;
      return {
        subject: `Assinatura em atraso: ${data.organizationName}`,
        ...layout(
          brand,
          [
            `Olá, ${data.partnerName}.`,
            `A assinatura de ${data.organizationName} está em atraso: o período pago venceu em ${formatDay(data.periodEnd)} e nenhum pagamento novo foi registrado.`,
            data.nextStepOn
              ? `Sem pagamento registrado, a assinatura será suspensa em ${formatDay(data.nextStepOn)}; o cliente passa a ter acesso só de leitura.`
              : "Sem pagamento registrado, a assinatura poderá ser suspensa.",
          ],
          { label: "Ver cobrança", url: safeLink(data.billingUrl) },
        ),
      };
    }
    case "billing.subscription.suspended": {
      const { data } = event;
      return {
        subject: `Assinatura suspensa: ${data.organizationName}`,
        ...layout(
          brand,
          [
            `Olá, ${data.partnerName}.`,
            `A assinatura de ${data.organizationName} foi suspensa por falta de pagamento do período que venceu em ${formatDay(data.periodEnd)}.`,
            "O cliente mantém o acesso de leitura e exportação, sem novas alterações. Registrar o pagamento reativa a assinatura.",
          ],
          { label: "Ver cobrança", url: safeLink(data.billingUrl) },
        ),
      };
    }
  }
}
