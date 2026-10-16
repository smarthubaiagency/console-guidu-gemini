import { describe, expect, it } from "vitest";

import { resolveSettings } from "@/core/settings/resolve";

import {
  AUTOMATION_AREAS,
  completeSkillSettings,
  DEFAULT_SKILL_SETTINGS,
  effectiveArea,
  nextArea,
} from "./areas";

describe("automation areas", () => {
  it("measures six configurable areas", () => {
    expect(AUTOMATION_AREAS).toHaveLength(6);
  });

  it("stays in suggest-only until the first review", () => {
    const area = effectiveArea(
      "reviews",
      DEFAULT_SKILL_SETTINGS,
      "auto",
      { enabled: true, autonomy: "auto", approvedAt: new Date() },
      false,
    );
    expect(area).toMatchObject({
      autonomy: "auto",
      effectiveAutonomy: "suggest",
      approved: true,
    });
    expect(
      effectiveArea(
        "reviews",
        DEFAULT_SKILL_SETTINGS,
        "auto",
        { enabled: true, autonomy: "auto", approvedAt: null },
        true,
      ).effectiveAutonomy,
    ).toBe("auto");
  });

  it("never goes above the ceiling and follows the cascade without a ficha override", () => {
    expect(
      effectiveArea(
        "reviews",
        DEFAULT_SKILL_SETTINGS,
        "approval",
        { enabled: true, autonomy: "auto", approvedAt: null },
        true,
      ).autonomy,
    ).toBe("approval");
    const skills = completeSkillSettings({
      care_hours: { enabled: false, autonomy: "auto" },
    });
    expect(effectiveArea("hours", skills, "auto", null, true)).toMatchObject({
      enabled: false,
      effectiveAutonomy: "suggest",
    });
  });

  it("goes to the next area not yet approved", () => {
    expect(nextArea("reviews", new Set(["reviews"]))).toBe("defense");
    expect(nextArea("photos", new Set(["photos", "reviews"]))).toBe("defense");
    expect(nextArea("info", new Set(AUTOMATION_AREAS))).toBeNull();
  });
});

describe("google_business keys of the cascade (ADR 0018)", () => {
  it("merges the skills level by level and lowers the ceiling only", () => {
    const { values } = resolveSettings([
      {
        scope: "platform",
        key: "google_business.skills",
        value: { respond_reviews: { enabled: true, autonomy: "auto" } },
        locked: false,
      },
      {
        scope: "partner",
        key: "google_business.skills",
        value: { write_posts: { enabled: false, autonomy: "approval" } },
        locked: false,
      },
      {
        scope: "workspace",
        key: "google_business.skills",
        value: { respond_reviews: { enabled: true, autonomy: "approval" } },
        locked: false,
      },
      {
        scope: "platform",
        key: "google_business.autonomy_ceiling",
        value: "approval",
        locked: false,
      },
      {
        scope: "partner",
        key: "google_business.autonomy_ceiling",
        value: "auto",
        locked: false,
      },
    ]);
    const skills = completeSkillSettings(values["google_business.skills"]);
    expect(skills.respond_reviews.autonomy).toBe("approval");
    expect(skills.write_posts.enabled).toBe(false);
    expect(skills.care_hours).toEqual({ enabled: true, autonomy: "approval" });
    expect(values["google_business.autonomy_ceiling"]).toBe("approval");
    expect(values["google_business.triggers"].quietStart).toBe("20:00");
  });
});
