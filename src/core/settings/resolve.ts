import {
  type EffectiveSettings,
  isSettingKey,
  isTightenOnly,
  isTurnOffOnly,
  narrowOf,
  SETTING_KEYS,
  SETTING_LEVELS,
  type SettingKey,
  type SettingLevel,
  SETTINGS,
} from "./catalog";

/**
 * Effective settings from the rows of the cascade (CF1). Pure: the reader
 * passes the rows of the platform, the context's partner and workspace.
 *
 * Per key, top-down: the catalog default, then each level the key allows.
 * A row that does not pass the catalog schema is ignored (an old value of a
 * changed key never breaks a page). A locked platform or partner row stops
 * the levels below, so a value written under a lock has no effect. A key
 * that only tightens (CF5a) locks itself wherever it is `true`; a switch
 * the levels below may only turn off (CF5b) stops them while it is `false`
 * above, the default counting as the first level's choice. A key the levels
 * below may only narrow (CF6a) combines each level's value with the one above.
 */

export type SettingRow = Readonly<{
  scope: SettingLevel;
  key: string;
  value: unknown;
  locked: boolean;
}>;

export type SettingSource = SettingLevel | "default";

export type ResolvedSetting = Readonly<{
  value: unknown;
  source: SettingSource;
  /** Level whose lock stops the levels below, if any. */
  lockedBy: SettingLevel | null;
}>;

export type ResolvedSettings = Readonly<{
  values: EffectiveSettings;
  detail: Readonly<Record<SettingKey, ResolvedSetting>>;
}>;

const levelIndex = (level: SettingLevel) => SETTING_LEVELS.indexOf(level);

function resolveKey(
  key: SettingKey,
  rows: readonly SettingRow[],
  above?: SettingLevel,
): ResolvedSetting & { candidates: unknown[] } {
  const definition = SETTINGS[key];
  let resolved: ResolvedSetting = {
    value: definition.default,
    source: "default",
    lockedBy: null,
  };
  const candidates: unknown[] = [definition.default];
  const first: SettingLevel = definition.levels[0] ?? "platform";
  for (const level of definition.levels) {
    if (isTurnOffOnly(key) && level !== first && resolved.value === false) {
      resolved = {
        ...resolved,
        lockedBy: resolved.source === "default" ? first : resolved.source,
      };
      break;
    }
    // Seen from `above`: only the levels over it count.
    if (above && levelIndex(level) >= levelIndex(above)) break;
    const row = rows.find((r) => r.scope === level && r.key === key);
    if (!row) continue;
    const parsed = definition.schema.safeParse(row.value);
    if (!parsed.success) continue;
    // A key the levels below only narrow (CF6a) keeps what the level above
    // allows; the first level sets the value as it is.
    const narrow = narrowOf(key);
    const value =
      narrow && level !== first
        ? narrow(resolved.value, parsed.data)
        : parsed.data;
    resolved = { value, source: level, lockedBy: null };
    candidates.push(value);
    const locks = row.locked || (isTightenOnly(key) && parsed.data === true);
    if (locks && level !== "workspace") {
      resolved = { ...resolved, lockedBy: level };
      break;
    }
  }
  return { ...resolved, candidates };
}

/** Effective values; `above` keeps only the levels above it (inheritance). */
export function resolveSettings(
  rows: readonly SettingRow[],
  options: Readonly<{ above?: SettingLevel }> = {},
): ResolvedSettings {
  const usable = rows.filter(
    (row) =>
      isSettingKey(row.key) &&
      (!options.above || levelIndex(row.scope) < levelIndex(options.above)),
  );
  const detail = {} as Record<SettingKey, ResolvedSetting>;
  const candidates = {} as Record<SettingKey, unknown[]>;
  for (const key of SETTING_KEYS) {
    const { candidates: list, ...resolved } = resolveKey(
      key,
      usable,
      options.above,
    );
    detail[key] = resolved;
    candidates[key] = list;
  }

  // The currency must be one the platform offers: the nearest level whose
  // choice is still offered wins, else the first offered.
  const offered = detail["region.currencies"].value as string[];
  if (!offered.includes(detail["region.currency"].value as string)) {
    const fallback = [...candidates["region.currency"]]
      .reverse()
      .find((code) => offered.includes(code as string));
    detail["region.currency"] = {
      ...detail["region.currency"],
      value: fallback ?? offered[0],
    };
  }

  const values = Object.fromEntries(
    SETTING_KEYS.map((key) => [key, detail[key].value]),
  ) as EffectiveSettings;
  return { values, detail };
}
