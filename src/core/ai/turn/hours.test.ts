import { describe, expect, it } from "vitest";

import { parseAgentConfig } from "../config/schema";
import { promptTexts } from "../prompt/texts";
import {
  afterHoursReply,
  businessHours,
  hoursInstruction,
  localStamp,
  localTime,
} from "./hours";

const TZ = "America/Sao_Paulo";
const weekdays = ["mon", "tue", "wed", "thu", "fri"] as const;
const slots = [
  ...weekdays.map((weekday) => ({ weekday, start: "08:00", end: "18:00" })),
  { weekday: "sat" as const, start: "09:00", end: "12:00" },
];

// 2026-10-19 is a Monday; Brasília is UTC-3.
const at = (local: string) => new Date(`${local}:00-03:00`);

describe("business hours (A6c)", () => {
  it("reads the local time in the agent's time zone", () => {
    expect(localTime(at("2026-10-18T22:10"), TZ)).toEqual({
      date: "2026-10-18",
      weekday: "sun",
      time: "22:10",
    });
    expect(localStamp(new Date("2026-10-19T01:10:00Z"), TZ)).toBe(
      "2026-10-18 22:10",
    );
  });

  it("is open inside a slot and closed at its end", () => {
    expect(businessHours(slots, at("2026-10-19T08:00"), TZ)).toEqual({
      configured: true,
      open: true,
      closedSince: null,
    });
    expect(businessHours(slots, at("2026-10-19T18:00"), TZ)).toEqual({
      configured: true,
      open: false,
      closedSince: "2026-10-19 18:00",
    });
  });

  it("finds when it closed, days back", () => {
    // Sunday night: closed since Saturday 12:00.
    expect(businessHours(slots, at("2026-10-18T22:00"), TZ).closedSince).toBe(
      "2026-10-17 12:00",
    );
    // Monday before opening: still since Saturday.
    expect(businessHours(slots, at("2026-10-19T07:59"), TZ).closedSince).toBe(
      "2026-10-17 12:00",
    );
    // Only Mondays: a week back.
    const monday = [{ weekday: "mon" as const, start: "10:00", end: "11:00" }];
    expect(businessHours(monday, at("2026-10-19T09:00"), TZ).closedSince).toBe(
      "2026-10-12 11:00",
    );
  });

  it("counts a business without hours as always open", () => {
    expect(businessHours(undefined, at("2026-10-18T03:00"), TZ)).toEqual({
      configured: false,
      open: true,
      closedSince: null,
    });
  });

  it("tells the model the time, the state and the after-hours rule", () => {
    const parsed = parseAgentConfig("guid", 1, {
      scope: { timezone: TZ, availability_slots: slots },
      rules: { after_hours_behavior: "offer_callback" },
    });
    if (!parsed.success) throw new Error("invalid config");
    const config = parsed.data;
    const texts = promptTexts("pt-BR");
    const now = at("2026-10-18T22:10");
    const closed = hoursInstruction(
      config,
      businessHours(slots, now, TZ),
      now,
      TZ,
      "pt-BR",
      texts,
    );
    expect(closed).toContain("domingo, 2026-10-18 22:10");
    expect(closed).toContain("O atendimento está fechado agora");
    expect(closed).toContain("seg-sex: 08:00 às 18:00");
    expect(closed).toContain(texts.afterHoursBehavior.offer_callback);

    const later = at("2026-10-19T09:00");
    const open = hoursInstruction(
      config,
      businessHours(slots, later, TZ),
      later,
      TZ,
      "pt-BR",
      texts,
    );
    expect(open).toContain("O atendimento está aberto agora");
    expect(open).not.toContain(texts.afterHoursBehavior.offer_callback);

    expect(afterHoursReply(config, texts)).toContain(
      "fora do horário de atendimento (seg-sex: 08:00 às 18:00; sáb: 09:00 às 12:00)",
    );
  });

  it("gives only the time when no hours were given", () => {
    const parsed = parseAgentConfig("guid", 1, {});
    if (!parsed.success) throw new Error("invalid config");
    const now = at("2026-10-18T22:10");
    const text = hoursInstruction(
      parsed.data,
      businessHours(undefined, now, TZ),
      now,
      TZ,
      "pt-BR",
      promptTexts("pt-BR"),
    );
    expect(text.split("\n")).toHaveLength(1);
  });
});
