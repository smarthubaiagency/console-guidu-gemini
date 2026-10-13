import { describe, expect, it, vi } from "vitest";

import { mergeMessages, type Messages } from "@/core/i18n/locales";
import { MESSAGE_FILES } from "@/i18n/messages";

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

describe("notices of the AI key (A2c)", () => {
  const data = {
    workspaceName: "Clínica <Sorriso>",
    agentName: null,
    backupUntil: new Date("2026-10-14T15:00:00Z"),
    credentialsUrl: "https://agencia-b.com.br/app/clinica/settings/credentials",
  };

  it("tells the customer about the backup and its end", () => {
    const message = renderNotification(
      {
        type: "ai.agent.key_backup",
        recipientEmail: "dono@clinica.test",
        idempotencyKey: "k",
        data,
      },
      brand,
    );
    expect(message.subject).toBe("A chave de IA de Clínica <Sorriso> falhou");
    expect(message.text).toContain("seu agente de IA em Clínica <Sorriso>");
    expect(message.text).toContain("Conversas novas não são atendidas.");
    expect(message.text).toContain("até 14/10/2026, 12:00");
    expect(message.text).toContain(
      "Trocar a chave: https://agencia-b.com.br/app/clinica/settings/credentials",
    );
    expect(message.html).toContain("Clínica &lt;Sorriso&gt;");
  });

  it("tells the customer about the pause, in English too", () => {
    const message = renderNotification(
      {
        type: "ai.agent.key_paused",
        recipientEmail: "dono@clinica.test",
        idempotencyKey: "k",
        data: { ...data, agentName: "Anna" },
      },
      brand,
      "en",
    );
    expect(message.subject).toBe("AI agent paused in Clínica <Sorriso>");
    expect(message.text).toContain("Anna in Clínica <Sorriso> was paused");
    expect(message.text).toContain("Replace the key: https://");
  });
});

describe("languages of the recipient (I5)", () => {
  const notice = {
    type: "billing.subscription.past_due" as const,
    recipientEmail: "cobranca@agencia-b.com.br",
    idempotencyKey: "k",
    data: {
      partnerName: "Agência B",
      organizationName: "Cliente <X>",
      periodEnd: new Date("2026-10-01T00:00:00Z"),
      nextStepOn: new Date("2026-10-11T00:00:00Z"),
      billingUrl: "https://agencia-b.com.br/admin/billing",
    },
  };

  it("renders the invitation in English, dates in the English format", () => {
    const message = renderNotification(event, brand, "en");
    expect(message.subject).toBe(
      'Invitation to Cliente "X" & Cia on Agência <B>',
    );
    expect(message.text).toContain("You have been invited to join");
    // ICU may separate "PM" with a narrow no-break space.
    expect(message.text).toMatch(
      /The invitation is valid until 10\/12\/26, 12:00\sPM\./,
    );
    expect(message.text).toContain("Accept invitation: https://");
    expect(message.text).toContain("Support: suporte@agencia-b.com.br");
    expect(message.text).toContain("Help: https://agencia-b.com.br/ajuda");
    expect(message.html).toContain("Cliente &quot;X&quot; &amp; Cia");
  });

  it("renders the billing notices in Spanish", () => {
    const pastDue = renderNotification(notice, brand, "es");
    expect(pastDue.subject).toBe("Suscripción vencida: Cliente <X>");
    expect(pastDue.text).toContain("Hola, Agência B.");
    expect(pastDue.text).toContain("terminó el 1/10/26");
    expect(pastDue.text).toContain("se suspenderá el 11/10/26");
    expect(pastDue.text).toContain("Ver facturación: https://");
    expect(pastDue.html).toContain("Cliente &lt;X&gt;");

    const suspended = renderNotification(
      {
        ...notice,
        type: "billing.subscription.suspended",
        data: { ...notice.data, nextStepOn: null },
      },
      brand,
      "es",
    );
    expect(suspended.subject).toBe("Suscripción suspendida: Cliente <X>");
    expect(suspended.text).toContain("lectura y exportación");
  });

  it("renders the billing notices in English", () => {
    const message = renderNotification(
      { ...notice, data: { ...notice.data, nextStepOn: null } },
      brand,
      "en",
    );
    expect(message.subject).toBe("Subscription past due: Cliente <X>");
    expect(message.text).toContain("ended on 10/1/26");
    expect(message.text).toContain(
      "Without a recorded payment, the subscription may be suspended.",
    );
  });

  it("applies the platform edits and falls back to the source texts", () => {
    const messages = mergeMessages(
      MESSAGE_FILES["pt-BR"] as Messages,
      MESSAGE_FILES.en as Messages,
      { "notifications.pastDue.subject": "Overdue: {organization}" },
    );
    expect(renderNotification(notice, brand, "en", messages).subject).toBe(
      "Overdue: Cliente <X>",
    );
    // A language added on the platform, without a file: Portuguese texts.
    expect(renderNotification(notice, brand, "fr").subject).toBe(
      "Assinatura em atraso: Cliente <X>",
    );
  });

  it("keeps Portuguese by default and passes the language to notify", async () => {
    expect(renderNotification(notice, brand).subject).toBe(
      "Assinatura em atraso: Cliente <X>",
    );
    const send = vi
      .fn()
      .mockResolvedValue({ status: "sent", providerMessageId: "m1" });
    await notify(notice, brand, { send }, { locale: "en" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Subscription past due: Cliente <X>",
      }),
    );
  });
});
