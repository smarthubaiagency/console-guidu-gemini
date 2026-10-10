import { describe, expect, it } from "vitest";

import { AppError } from "@/shared/errors";

import {
  addInterval,
  addMonths,
  assertTransition,
  canTransition,
  nextPeriod,
  statusAfterPayment,
  SUBSCRIPTION_STATUSES,
} from "./subscriptions";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("subscription transitions", () => {
  it("never leaves canceled", () => {
    for (const to of SUBSCRIPTION_STATUSES) {
      if (to !== "canceled") expect(canTransition("canceled", to)).toBe(false);
    }
  });

  it("never goes back to pending", () => {
    for (const from of SUBSCRIPTION_STATUSES) {
      if (from !== "pending")
        expect(canTransition(from, "pending")).toBe(false);
    }
  });

  it("follows the explicit machine", () => {
    expect(canTransition("pending", "active")).toBe(true);
    expect(canTransition("active", "past_due")).toBe(true);
    expect(canTransition("past_due", "suspended")).toBe(true);
    expect(canTransition("suspended", "active")).toBe(true);
    expect(canTransition("pending", "suspended")).toBe(false);
    expect(() => assertTransition("canceled", "active")).toThrow(AppError);
  });
});

describe("periods", () => {
  it("clamps month ends", () => {
    expect(addMonths(day("2026-01-31"), 1)).toEqual(day("2026-02-28"));
    expect(addMonths(day("2028-01-31"), 1)).toEqual(day("2028-02-29"));
    expect(addMonths(day("2026-12-15"), 1)).toEqual(day("2027-01-15"));
    expect(addInterval(day("2026-10-10"), "yearly")).toEqual(day("2027-10-10"));
  });

  it("starts on the payment day, then continues without gaps", () => {
    expect(
      nextPeriod("monthly", null, new Date("2026-10-05T15:30:00Z")),
    ).toEqual({
      start: day("2026-10-05"),
      end: day("2026-11-05"),
    });
    // A late payment still covers the period that follows the previous one.
    expect(nextPeriod("monthly", day("2026-11-05"), day("2026-12-20"))).toEqual(
      {
        start: day("2026-11-05"),
        end: day("2026-12-05"),
      },
    );
  });

  it("is active only while the paid period has not ended", () => {
    expect(statusAfterPayment(day("2026-11-05"), day("2026-10-10"))).toBe(
      "active",
    );
    expect(statusAfterPayment(day("2026-12-05"), day("2026-12-20"))).toBe(
      "past_due",
    );
    expect(
      statusAfterPayment(day("2026-12-05"), new Date("2026-12-05T10:00:00Z")),
    ).toBe("past_due");
  });
});
