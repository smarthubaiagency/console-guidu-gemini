import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  NOTIFICATION_EVENTS,
  PREFERENCE_EVENTS,
} from "@/core/notifications/channels";
import { EMAIL_TEMPLATE_EVENTS } from "@/core/notifications/template-catalog";

import {
  EVENT_AUDIENCES,
  EVENT_CATALOG,
  EVENT_CHANNELS,
  EVENT_DESTINATIONS,
  EVENT_ROUTES,
  eventDefinition,
  IMPLEMENTED_DESTINATIONS,
  isEventType,
  missingDestinations,
} from "./catalog";
import { requireEmittable } from "./emit";

const FORMAT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

describe("Event Hub catalog (H1)", () => {
  it("has unique types in the database format, with known values", () => {
    const types = EVENT_CATALOG.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    for (const definition of EVENT_CATALOG) {
      expect(definition.type).toMatch(FORMAT);
      expect(definition.type.length).toBeLessThanOrEqual(80);
      expect(definition.module).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(definition.audiences.length).toBeGreaterThan(0);
      for (const audience of definition.audiences) {
        expect(EVENT_AUDIENCES).toContain(audience);
      }
      for (const destination of definition.destinations) {
        expect(EVENT_DESTINATIONS).toContain(destination);
      }
      for (const channel of definition.channels) {
        expect(EVENT_CHANNELS).toContain(channel);
      }
      expect(EVENT_ROUTES).toContain(definition.route);
      // A notify destination without a channel would tell nobody.
      if (definition.destinations.includes("notify")) {
        expect(definition.channels.length).toBeGreaterThan(0);
      }
    }
  });

  it("builds only notify and audit; the rest are refused with their stage", () => {
    expect([...IMPLEMENTED_DESTINATIONS].sort()).toEqual(["audit", "notify"]);
    const lead = eventDefinition("digital_profile.lead.submitted");
    expect(lead && missingDestinations(lead)).toEqual(["analytics"]);
    expect(() => requireEmittable("digital_profile.lead.submitted")).toThrow(
      /analytics \(H3\)/,
    );
    expect(() => requireEmittable("nao.existe")).toThrow(/fora do catálogo/);
    // Sent by the request itself, never as an event row.
    expect(() => requireEmittable("invitation.created")).toThrow(
      /própria requisição/,
    );
    expect(requireEmittable("ai.agent.key_backup").route).toBe("service_mode");
    expect(isEventType("billing.subscription.past_due")).toBe(true);
    expect(isEventType("billing.subscription.paid")).toBe(false);
  });

  it("keeps the routes of today's notices", () => {
    const route = (type: string) => eventDefinition(type)?.route;
    expect(route("workspace.deletion.scheduled")).toBe("customer");
    expect(route("workspace.deletion.completed")).toBe("customer");
    expect(route("billing.subscription.past_due")).toBe("partner");
    expect(route("billing.subscription.suspended")).toBe("partner");
    expect(route("ai.agent.key_backup")).toBe("service_mode");
    expect(route("ai.agent.key_paused")).toBe("service_mode");
    expect(route("google_business.analyses_done")).toBe("subject_person");
    expect(route("ai.agent.lead_hot")).toBe("explicit");
    expect(route("ai.agent.referral_recommended")).toBe("explicit");
    expect(eventDefinition("ai.agent.lead_hot")?.channels).toEqual([
      "whatsapp",
    ]);
    expect(
      eventDefinition("platform.events.chain_broken")?.destinations,
    ).toEqual(["audit", "notify"]);
  });

  it("derives the e-mail templates and the channels without changing them", () => {
    expect(EMAIL_TEMPLATE_EVENTS.map((e) => [e.type, e.group, e.key])).toEqual([
      ["invitation.created", "account", "invitation"],
      ["email.test", "account", "emailTest"],
      ["workspace.deletion.scheduled", "account", "workspaceDeletionScheduled"],
      ["workspace.deletion.reminder", "account", "workspaceDeletionReminder"],
      ["workspace.deletion.canceled", "account", "workspaceDeletionCanceled"],
      ["workspace.deletion.completed", "account", "workspaceDeletionCompleted"],
      ["billing.subscription.past_due", "billing", "pastDue"],
      ["billing.subscription.suspended", "billing", "suspended"],
      ["ai.agent.key_backup", "ai", "aiKeyBackup"],
      ["ai.agent.key_paused", "ai", "aiKeyPaused"],
    ]);
    expect(EMAIL_TEMPLATE_EVENTS.every((e) => e.essential)).toBe(true);
    expect(
      Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e.type, e.channels])),
    ).toEqual({
      "invitation.created": ["email"],
      "email.test": ["email"],
      "workspace.deletion.scheduled": ["email", "app"],
      "workspace.deletion.reminder": ["email", "app"],
      "workspace.deletion.canceled": ["email", "app"],
      "workspace.deletion.completed": ["email", "app"],
      "billing.subscription.past_due": ["email", "app"],
      "billing.subscription.suspended": ["email", "app"],
      "ai.agent.key_backup": ["email", "app"],
      "ai.agent.key_paused": ["email", "app"],
    });
    // The matrix of Minha conta: the deletion notices (WS1), locked, and
    // the four rows it had.
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
});
