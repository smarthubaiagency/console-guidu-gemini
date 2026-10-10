import { describe, expect, it, vi } from "vitest";

import { notify } from "./notify";
import { escapeHtml, renderNotification } from "./templates";
import type { NotificationEvent } from "./types";

const brand = {
  name: "Agência <B>",
  supportEmail: "suporte@agencia-b.com.br",
  supportUrl: "https://agencia-b.com.br/ajuda",
};

const event: NotificationEvent = {
  type: "invitation.created",
  recipientEmail: "pessoa@cliente.com.br",
  idempotencyKey: "invitation:123",
  data: {
    inviteUrl: "https://app.agencia-b.com.br/invite/abc",
    organizationName: 'Cliente "X" & Cia',
    expiresAt: new Date("2026-10-12T15:00:00Z"),
  },
};

describe("renderNotification", () => {
  it("uses the partner brand in subject, body and footer", () => {
    const message = renderNotification(event, brand);
    expect(message.subject).toBe(
      'Convite para Cliente "X" & Cia no Agência <B>',
    );
    expect(message.text).toContain("https://app.agencia-b.com.br/invite/abc");
    expect(message.text).toContain("Suporte: suporte@agencia-b.com.br");
    expect(message.text).toContain("12/10/2026");
  });

  it("escapes every value in the HTML version", () => {
    const { html } = renderNotification(event, brand);
    expect(html).toContain("Agência &lt;B&gt;");
    expect(html).toContain("Cliente &quot;X&quot; &amp; Cia");
    expect(html).not.toContain("<B>");
  });

  it("refuses non-http links", () => {
    expect(() =>
      renderNotification(
        { ...event, data: { ...event.data, inviteUrl: "javascript:alert(1)" } },
        brand,
      ),
    ).toThrow();
  });

  it("omits support lines that are not set", () => {
    const { text } = renderNotification(event, {
      name: "GUIDU",
      supportEmail: null,
      supportUrl: null,
    });
    expect(text).not.toContain("Suporte:");
    expect(text).not.toContain("Ajuda:");
  });
});

describe("notify", () => {
  it("skips delivery while no provider is configured", async () => {
    await expect(notify(event, brand)).resolves.toEqual({
      status: "skipped",
      reason: "no_provider",
    });
  });

  it("hands the rendered message to the transport", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ status: "sent", providerMessageId: "m1" });
    await notify(event, brand, { send });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "pessoa@cliente.com.br",
        idempotencyKey: "invitation:123",
        eventType: "invitation.created",
      }),
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("billing notices (F3c)", () => {
  const data = {
    partnerName: "Agência B",
    organizationName: "Cliente <X>",
    periodEnd: new Date("2026-10-01T00:00:00Z"),
    nextStepOn: new Date("2026-10-11T00:00:00Z"),
    billingUrl: "https://agencia-b.com.br/admin/billing",
  };

  it("tells the partner about the arrears and the suspension date", () => {
    const message = renderNotification(
      {
        type: "billing.subscription.past_due",
        recipientEmail: "cobranca@agencia-b.com.br",
        idempotencyKey: "k",
        data,
      },
      brand,
    );
    expect(message.subject).toBe("Assinatura em atraso: Cliente <X>");
    expect(message.text).toContain("venceu em 01/10/2026");
    expect(message.text).toContain("suspensa em 11/10/2026");
    expect(message.text).toContain("https://agencia-b.com.br/admin/billing");
    expect(message.html).toContain("Cliente &lt;X&gt;");
  });

  it("explains what a suspension means for the customer", () => {
    const message = renderNotification(
      {
        type: "billing.subscription.suspended",
        recipientEmail: "cobranca@agencia-b.com.br",
        idempotencyKey: "k",
        data: { ...data, nextStepOn: null },
      },
      brand,
    );
    expect(message.subject).toBe("Assinatura suspensa: Cliente <X>");
    expect(message.text).toContain("leitura e exportação");
  });
});
