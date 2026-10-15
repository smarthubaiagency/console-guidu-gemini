import { z } from "zod";

/**
 * Settings catalog (CF1, levantamento.md): what each key means, where it may
 * be set and its default. The `settings` table only holds overrides; a key
 * that is not here is ignored by the reader and refused by the writer.
 *
 * Levels, top-down: the platform sets the default (and may lock it), the
 * partner adjusts it for its customers, the workspace for itself. A key
 * never holds a secret: the values of the upper levels are readable by
 * whoever reads the cascade.
 */

export type SettingLevel = "platform" | "partner" | "workspace";

export const SETTING_LEVELS: readonly SettingLevel[] = [
  "platform",
  "partner",
  "workspace",
];

/** Every ISO 4217 code the runtime knows. */
export const CURRENCY_CODES: readonly string[] =
  Intl.supportedValuesOf("currency");

/** Every IANA time zone the runtime knows, plus UTC. */
export const TIME_ZONES: readonly string[] = [
  "UTC",
  ...Intl.supportedValuesOf("timeZone"),
];

const currencyCode = z
  .string()
  .refine((code) => CURRENCY_CODES.includes(code), "unknown currency");

const timeZone = z
  .string()
  .refine((zone) => TIME_ZONES.includes(zone), "unknown time zone");

type Definition<T> = Readonly<{
  schema: z.ZodType<T>;
  default: T;
  /** Levels where the key may be set, top-down. */
  levels: readonly SettingLevel[];
  /**
   * A requirement that only tightens (CF5a): a `true` above stops the levels
   * below as if locked, and nobody locks it by hand.
   */
  tightenOnly?: boolean;
}>;

function define<T>(definition: Definition<T>): Definition<T> {
  return definition;
}

export const SETTINGS = {
  /** Currencies offered to partners and workspaces (platform only). */
  "region.currencies": define<string[]>({
    schema: z.array(currencyCode).min(1).max(30),
    default: ["BRL", "USD", "EUR"],
    levels: ["platform"],
  }),
  /** Default currency of prices (Portfolio) and money shown in the panel. */
  "region.currency": define<string>({
    schema: currencyCode,
    default: "BRL",
    levels: ["platform", "partner", "workspace"],
  }),
  /** Time zone of business hours, schedules and agents without their own. */
  "region.timezone": define<string>({
    schema: timeZone,
    default: "America/Sao_Paulo",
    levels: ["platform", "partner", "workspace"],
  }),
  /**
   * Sender name of the e-mails (CF3a). Null uses the brand name. The
   * sending address is the platform's verified one (EMAIL_FROM_ADDRESS).
   */
  "email.from_name": define<string | null>({
    schema: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^"<>\r\n]+$/, "invalid sender name")
      .nullable(),
    default: null,
    levels: ["platform", "partner"],
  }),
  /** Reply-to address of the e-mails (CF3a). Null uses the brand's support e-mail. */
  "email.reply_to": define<string | null>({
    schema: z.string().trim().toLowerCase().email().max(254).nullable(),
    default: null,
    levels: ["platform", "partner"],
  }),
  /**
   * Second factor required in the workspaces (CF5a): the platform for every
   * workspace, the partner for its customers, the workspace for its team.
   * /platform and /admin always require it, outside the cascade.
   */
  "security.mfa.app": define<boolean>({
    schema: z.boolean(),
    default: false,
    levels: ["platform", "partner", "workspace"],
    tightenOnly: true,
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;

export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K]["default"];

export type EffectiveSettings = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

/** True for keys that only tighten (a `true` above locks the levels below). */
export function isTightenOnly(key: SettingKey): boolean {
  return (SETTINGS[key] as Definition<unknown>).tightenOnly === true;
}

/** Keys a level may set. */
export function keysOfLevel(level: SettingLevel): SettingKey[] {
  return SETTING_KEYS.filter((key) =>
    (SETTINGS[key].levels as readonly SettingLevel[]).includes(level),
  );
}
