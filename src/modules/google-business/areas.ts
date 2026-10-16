import { z } from "zod";

import type { AnalysisArea } from "./analyses/contract";

/**
 * Areas of the automation page and the base skills of the GMN agent
 * (especificação §8.2). Pure: read by the settings catalog, the server and
 * the screens. The page measures configuration ("X de 6 áreas
 * configuradas"), never "optimization".
 */

/** Areas configured on the automation page, in display order. */
export const AUTOMATION_AREAS = [
  "reviews",
  "defense",
  "info",
  "hours",
  "posts",
  "photos",
] as const;
export type AutomationArea = (typeof AUTOMATION_AREAS)[number];

export function isAutomationArea(value: string): value is AutomationArea {
  return (AUTOMATION_AREAS as readonly string[]).includes(value);
}

/** Areas of the contract shown as analyses only (no switch on the page). */
export const INSIGHT_AREAS: readonly AnalysisArea[] = ["services", "maps"];

export const AUTONOMY_LEVELS = ["suggest", "approval", "auto"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

const AUTONOMY_RANK: Readonly<Record<Autonomy, number>> = {
  suggest: 0,
  approval: 1,
  auto: 2,
};

/** The stricter of two autonomy levels. */
export function minAutonomy(a: Autonomy, b: Autonomy): Autonomy {
  return AUTONOMY_RANK[a] <= AUTONOMY_RANK[b] ? a : b;
}

/** Base skills of the platform, locked (especificação §8.1 and §8.2). */
export const BASE_SKILLS = [
  "respond_reviews",
  "escalate_negative_review",
  "request_reviews",
  "write_posts",
  "publish_photos",
  "care_hours",
  "sync_services",
  "optimize_info",
  "defend_profile",
  "maps_health",
  "reports",
] as const;
export type BaseSkill = (typeof BASE_SKILLS)[number];

/** Skills each area of the page switches on and off together. */
export const AREA_SKILLS: Readonly<
  Record<AutomationArea, readonly BaseSkill[]>
> = {
  reviews: ["respond_reviews", "escalate_negative_review", "request_reviews"],
  defense: ["defend_profile"],
  info: ["optimize_info", "sync_services"],
  hours: ["care_hours"],
  posts: ["write_posts"],
  photos: ["publish_photos"],
};

/** Contract areas whose findings show as tips of each page area. */
export const AREA_FINDING_AREAS: Readonly<
  Record<AutomationArea, readonly AnalysisArea[]>
> = {
  reviews: ["reviews"],
  defense: ["defense"],
  info: ["info"],
  hours: ["hours"],
  posts: ["posts"],
  photos: ["photos"],
};

export const SkillSettingSchema = z.strictObject({
  enabled: z.boolean(),
  autonomy: z.enum(AUTONOMY_LEVELS),
});
export type SkillSetting = z.infer<typeof SkillSettingSchema>;

export type SkillSettings = Readonly<Record<BaseSkill, SkillSetting>>;

/** A level may set only some skills; the rest comes from above. */
export const SkillSettingsSchema = z
  .partialRecord(z.enum(BASE_SKILLS), SkillSettingSchema)
  .refine((value) => Object.keys(value).length <= BASE_SKILLS.length);

/** Platform default: every base skill on, asking for approval. */
export const DEFAULT_SKILL_SETTINGS: SkillSettings = Object.fromEntries(
  BASE_SKILLS.map((skill) => [skill, { enabled: true, autonomy: "approval" }]),
) as SkillSettings;

/** Below overrides above, skill by skill (the levels merge, ADR 0018). */
export function mergeSkillSettings(
  above: Partial<Record<BaseSkill, SkillSetting>>,
  below: Partial<Record<BaseSkill, SkillSetting>>,
): Partial<Record<BaseSkill, SkillSetting>> {
  return { ...above, ...below };
}

/** Every skill filled from the defaults. */
export function completeSkillSettings(
  value: Partial<Record<BaseSkill, SkillSetting>>,
): SkillSettings {
  return { ...DEFAULT_SKILL_SETTINGS, ...value };
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Default triggers (especificação §8.5). */
export const TriggerSettingsSchema = z.strictObject({
  newReviewDraftMinutes: z.number().int().min(1).max(1440),
  diagnosisWeekday: z.number().int().min(0).max(6),
  diagnosisHour: z.number().int().min(0).max(23),
  mapsEveryDays: z.number().int().min(7).max(90),
  holidaysLookaheadDays: z.number().int().min(7).max(120),
  quietStart: time,
  quietEnd: time,
  quietSundays: z.boolean(),
});
export type TriggerSettings = z.infer<typeof TriggerSettingsSchema>;

export const DEFAULT_TRIGGER_SETTINGS: TriggerSettings = {
  newReviewDraftMinutes: 15,
  diagnosisWeekday: 1,
  diagnosisHour: 8,
  mapsEveryDays: 30,
  holidaysLookaheadDays: 45,
  quietStart: "20:00",
  quietEnd: "08:00",
  quietSundays: true,
};

/** What the ficha level stores for an area (gb_area_settings). */
export type AreaOverride = Readonly<{
  enabled: boolean;
  autonomy: Autonomy;
  approvedAt: Date | null;
}>;

export type EffectiveArea = Readonly<{
  area: AutomationArea;
  enabled: boolean;
  /** Autonomy chosen (ficha level, else the cascade), within the ceiling. */
  autonomy: Autonomy;
  /** What the agent may really do now: "suggest" until the first review. */
  effectiveAutonomy: Autonomy;
  approved: boolean;
}>;

/**
 * The effective configuration of an area: the cascade (skills of the area)
 * overridden by the ficha level, never above the ceiling, and "suggest
 * only" while nobody has reviewed the page (the lock of §7).
 */
export function effectiveArea(
  area: AutomationArea,
  skills: SkillSettings,
  ceiling: Autonomy,
  override: AreaOverride | null,
  reviewed: boolean,
): EffectiveArea {
  const areaSkills = AREA_SKILLS[area].map((skill) => skills[skill]);
  const cascadeEnabled = areaSkills.some((s) => s.enabled);
  const cascadeAutonomy = areaSkills
    .map((s) => s.autonomy)
    .reduce<Autonomy>((acc, a) => minAutonomy(acc, a), "auto");
  const enabled = override ? override.enabled : cascadeEnabled;
  const autonomy = minAutonomy(
    override ? override.autonomy : cascadeAutonomy,
    ceiling,
  );
  return {
    area,
    enabled,
    autonomy,
    effectiveAutonomy: !enabled ? "suggest" : reviewed ? autonomy : "suggest",
    approved: Boolean(override?.approvedAt),
  };
}

/** The next area to review after `area`, in page order (null at the end). */
export function nextArea(
  area: AutomationArea,
  approved: ReadonlySet<AutomationArea>,
): AutomationArea | null {
  const start = AUTOMATION_AREAS.indexOf(area);
  for (let i = 1; i <= AUTOMATION_AREAS.length; i += 1) {
    const candidate = AUTOMATION_AREAS[(start + i) % AUTOMATION_AREAS.length]!;
    if (!approved.has(candidate)) return candidate;
  }
  return null;
}
