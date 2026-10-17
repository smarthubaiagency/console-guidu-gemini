import { describe, expect, it } from "vitest";

import { createTranslator } from "next-intl";

import { MESSAGE_FILES } from "@/i18n/messages";

import {
  canChangeChannel,
  channelEnabled,
  NOTIFICATION_EVENTS,
  PREFERENCE_EVENTS,
  resolveChannels,
  type NotificationEventDefinition,
} from "./channels";
import { inboxNotice, renderInboxNotice } from "./inbox-content";
import { EMAIL_TEMPLATE_EVENTS } from "./template-catalog";

const optional: NotificationEventDefinition = {
  type: "ai.agent.key_backup",
  group: "ai",
  key: "aiKeyBackup",
  essential: false,
  channels: ["email", "app"],
};

describe("notification channels (CF3c)", () => {
  it("gives every event of the catalog its channels", () => {
    expect(NOTIFICATION_EVENTS.map((e) => e.type)).toEqual(
      EMAIL_TEMPLATE_EVENTS.map((e) => e.type),
    );
    for (const event of NOTIFICATION_EVENTS) {
      expect(event.channels, event.type).toContain("email");
    }
    // Invitations and the test e-mail never reach a bell or the matrix.
    expect(PREFERENCE_EVENTS.map((e) => e.type)).toEqual([
      "workspace.deletion.scheduled",
      "workspace.deletion.reminder",
      "workspace.deletion.canceled",
      "workspace.deletion.completed",
      "billing.subscription.past_due",
      "billing.subscription.suspended",
      "ai.agent.key_backup",
      "ai.agent.key_paused",
    ]);
  });

  it("keeps every channel of an essential event on, whatever the preference", () => {
    const pastDue = NOTIFICATION_EVENTS.find(
      (e) => e.type === "billing.subscription.past_due",
    )!;
    expect(pastDue.essential).toBe(true);
    const off = [
      { eventType: pastDue.type, channel: "email", enabled: false },
      { eventType: pastDue.type, channel: "app", enabled: false },
    ];
    expect([...resolveChannels(pastDue, off)]).toEqual(["email", "app"]);
    expect(canChangeChannel(pastDue, "email")).toBe(false);
    expect(canChangeChannel(pastDue, "app")).toBe(false);
  });

  it("follows the person's choice for an optional event; no row is on", () => {
    expect([...resolveChannels(optional, [])]).toEqual(["email", "app"]);
    expect([
      ...resolveChannels(optional, [
        { eventType: optional.type, channel: "app", enabled: false },
        // Another event's row does not count.
        { eventType: "ai.agent.key_paused", channel: "email", enabled: false },
      ]),
    ]).toEqual(["email"]);
    expect(canChangeChannel(optional, "app")).toBe(true);
  });

  it("never adds a channel the event does not have", () => {
    const emailOnly = NOTIFICATION_EVENTS.find(
      (e) => e.type === "invitation.created",
    )!;
    expect([
      ...resolveChannels(emailOnly, [
        { eventType: emailOnly.type, channel: "app", enabled: true },
      ]),
    ]).toEqual(["email"]);
    expect(canChangeChannel({ ...optional, channels: ["email"] }, "app")).toBe(
      false,
    );
    // An unknown event keeps the e-mail only.
    expect(channelEnabled(null, "email", [])).toBe(true);
    expect(channelEnabled(null, "app", [])).toBe(false);
  });
});

describe("notices of the bell", () => {
  it("keeps names, days and the link of a billing event", () => {
    expect(
      inboxNotice({
        type: "billing.subscription.past_due",
        data: {
          partnerName: "Agência",
          organizationName: "  Cliente X  ",
          periodEnd: new Date("2026-10-01T00:00:00Z"),
          nextStepOn: new Date("2026-10-08T00:00:00Z"),
          billingUrl: "https://agencia.test/admin/billing",
        },
      }),
    ).toEqual({
      eventType: "billing.subscription.past_due",
      data: {
        organization: "Cliente X",
        periodEnd: "2026-10-01",
        nextStepOn: "2026-10-08",
      },
      linkUrl: "https://agencia.test/admin/billing",
    });
  });

  it("drops an unsafe link and has no notice for e-mail only events", () => {
    const notice = inboxNotice({
      type: "ai.agent.key_paused",
      data: {
        workspaceName: "Loja",
        agentName: null,
        backupUntil: new Date("2026-10-02T12:00:00Z"),
        credentialsUrl: "javascript:alert(1)",
      },
    });
    expect(notice).toMatchObject({
      data: { workspace: "Loja", until: "2026-10-02T12:00:00.000Z" },
      linkUrl: null,
    });
    expect(
      inboxNotice({
        type: "email.test",
        data: { settingsUrl: "https://x.test" },
      }),
    ).toBeNull();
  });

  it("writes a stored notice in each language", () => {
    const format = (value: Date) => value.toISOString().slice(0, 10);
    for (const locale of ["pt-BR", "en", "es"] as const) {
      const t = createTranslator({
        locale,
        messages: MESSAGE_FILES[locale],
        namespace: "notificationCenter.events",
      });
      const translate = (key: string, values: Record<string, string>) =>
        t(key as never, values as never);
      const pastDue = renderInboxNotice(
        {
          eventType: "billing.subscription.past_due",
          data: {
            organization: "Cliente X",
            periodEnd: "2026-10-01",
            nextStepOn: "2026-10-08",
          },
        },
        translate,
        format,
      );
      expect(pastDue.title, locale).toContain("Cliente X");
      expect(pastDue.body, locale).toContain("2026-10-01");
      expect(pastDue.body, locale).toContain("2026-10-08");

      const backup = renderInboxNotice(
        {
          eventType: "ai.agent.key_backup",
          data: { workspace: "Loja", until: "2026-10-02T12:00:00.000Z" },
        },
        translate,
        format,
      );
      expect(backup.title, locale).toContain("Loja");
      expect(backup.body, locale).toContain("2026-10-02");

      // Tampered or unknown rows still render, without their values.
      const unknown = renderInboxNotice(
        { eventType: "x.y", data: null },
        translate,
        format,
      );
      expect(unknown.title.length, locale).toBeGreaterThan(0);
      const odd = renderInboxNotice(
        {
          eventType: "billing.subscription.suspended",
          data: { organization: 42, periodEnd: "not a date" },
        },
        translate,
        format,
      );
      expect(odd.body, locale).not.toContain("not a date");
    }
  });
});
