import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  billingSchedules,
  DEFAULT_BILLING_TERMS,
  monthBounds,
  overdueSchedule,
  previousMonth,
  transitionFor,
} from "./automation";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const terms = DEFAULT_BILLING_TERMS;

describe("transitionFor (decision 4: 3 days, then 7 more)", () => {
  const periodEnd = day("2026-10-01");

  it("keeps an active subscription until the tolerance ends", () => {
    for (const today of ["2026-09-30", "2026-10-01", "2026-10-03"]) {
      expect(
        transitionFor(
          { status: "active", currentPeriodEnd: periodEnd },
          day(today),
          terms,
        ),
      ).toBeNull();
    }
    expect(
      transitionFor(
        { status: "active", currentPeriodEnd: periodEnd },
        day("2026-10-04"),
        terms,
      ),
    ).toBe("past_due");
  });

  it("suspends after the grace counted from the arrears date", () => {
    const sub = { status: "past_due", currentPeriodEnd: periodEnd };
    expect(transitionFor(sub, day("2026-10-10"), terms)).toBeNull();
    expect(transitionFor(sub, day("2026-10-11"), terms)).toBe("suspended");
    expect(overdueSchedule(periodEnd, terms)).toEqual({
      pastDueOn: day("2026-10-04"),
      suspendOn: day("2026-10-11"),
    });
  });

  it("moves one step per run, even when far overdue", () => {
    expect(
      transitionFor(
        { status: "active", currentPeriodEnd: periodEnd },
        day("2026-12-01"),
        terms,
      ),
    ).toBe("past_due");
  });

  it("ignores pending, suspended, canceled and subscriptions without a period", () => {
    for (const status of ["pending", "suspended", "canceled"]) {
      expect(
        transitionFor(
          { status, currentPeriodEnd: periodEnd },
          day("2026-12-01"),
          terms,
        ),
      ).toBeNull();
    }
    expect(
      transitionFor(
        { status: "active", currentPeriodEnd: null },
        day("2026-12-01"),
        terms,
      ),
    ).toBeNull();
  });

  it("uses the configured terms and the time of day does not matter", () => {
    const custom = { pastDueAfterDays: 0, suspendAfterDays: 1 };
    expect(
      transitionFor(
        { status: "active", currentPeriodEnd: periodEnd },
        new Date("2026-10-01T23:59:00Z"),
        custom,
      ),
    ).toBe("past_due");
    expect(
      transitionFor(
        { status: "past_due", currentPeriodEnd: periodEnd },
        day("2026-10-02"),
        custom,
      ),
    ).toBe("suspended");
  });
});

describe("billing schedules", () => {
  const [daily, monthly] = billingSchedules;

  it("starts the day's run from 06:00 in Brasília, keyed by date", () => {
    expect(daily?.due(new Date("2026-10-04T08:59:00Z"))).toBeNull();
    expect(daily?.due(new Date("2026-10-04T09:00:00Z"))).toEqual({
      key: "2026-10-04",
      payload: { date: "2026-10-04" },
    });
  });

  it("reports the closed month, keyed by month", () => {
    expect(monthly?.due(new Date("2026-01-01T00:10:00Z"))).toEqual({
      key: "2025-12",
      payload: { month: "2025-12" },
    });
    expect(previousMonth(new Date("2026-03-31T12:00:00Z"))).toBe("2026-02");
    expect(monthBounds("2025-12")).toEqual({
      start: day("2025-12-01"),
      end: day("2026-01-01"),
    });
  });
});
