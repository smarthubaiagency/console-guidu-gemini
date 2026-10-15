import {
  type EffectiveSettings,
  isSettingKey,
  isTightenOnly,
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
 * that only tightens (CF5a) locks itself wherever it is `true`.
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
): ResolvedSetting & { candidates: unknown[] } {
  const definition = SETTINGS[key];
  let resolved: ResolvedSetting = {
    value: definition.default,
    source: "default",
    lockedBy: null,
  };
  const candidates: unknown[] = [definition.default];
  for (const level of definition.levels) {
    const row = rows.find((r) => r.scope === level && r.key === key);
    if (!row) continue;
    const parsed = definition.schema.safeParse(row.value);
    if (!parsed.success) continue;
    resolved = { value: parsed.data, source: level, lockedBy: null };
    candidates.push(parsed.data);
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
    const { candidates: list, ...resolved } = resolveKey(key, usable);
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
