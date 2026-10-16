import { z } from "zod";

import {
  AI_PROVIDERS,
  type AiProviderId,
  type BaseUrls,
  BaseUrlsSchema,
  DEFAULT_MODEL_CATALOG,
  type ModelCatalog,
  ModelCatalogSchema,
  narrowCatalog,
  narrowProviders,
  ProvidersSchema,
} from "@/core/ai/models";
import {
  ANALYTICS_PROVIDERS,
  type AnalyticsProvider,
  POSTHOG_REGIONS,
  type PosthogRegion,
  SiteIdSchema,
} from "@/core/analytics/config";
import {
  GOOGLE_SCOPES,
  type GoogleScope,
  GoogleScopesSchema,
  narrowGoogleScopes,
} from "@/core/integrations/google/scopes";
import {
  WorkspaceScopeSchema,
  type WorkspaceScopeType,
} from "@/core/mcp/scopes";
import {
  AUTONOMY_LEVELS,
  type Autonomy,
  type BaseSkill,
  DEFAULT_TRIGGER_SETTINGS,
  mergeSkillSettings,
  minAutonomy,
  type SkillSetting,
  SkillSettingsSchema,
  type TriggerSettings,
  TriggerSettingsSchema,
} from "@/modules/google-business/areas";

/** Scopes each plan allows its API keys (CF6b), by plan key. */
const PlanScopesSchema = z
  .record(
    z
      .string()
      .max(48)
      .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
    z.array(WorkspaceScopeSchema).max(20),
  )
  .refine((value) => Object.keys(value).length <= 50, "too many plans");

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
  /**
   * A switch the first level turns on and the levels below may only turn
   * off (CF5b): while it is `false` above (the default included), the
   * levels below are stopped as if locked.
   */
  turnOffOnly?: boolean;
  /**
   * A choice the levels below may only narrow (CF6a): the value of a level
   * below the first is combined with the one above by this function, so it
   * never offers what the level above took away.
   */
  narrow?: (above: T, below: T) => T;
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
  /**
   * "Entrar com Google" on the login page (CF5b): the platform offers it,
   * the partner may hide it on its hosts. The button only shows when the
   * provider is also on in Supabase Auth (`AUTH_GOOGLE_ENABLED`).
   */
  "auth.google": define<boolean>({
    schema: z.boolean(),
    default: false,
    levels: ["platform", "partner"],
    turnOffOnly: true,
  }),
  /**
   * Sign-in link by e-mail on the login page (CF5b), off by default: the
   * platform offers it, the partner may hide it on its hosts. Shown only
   * when `AUTH_MAGIC_LINK_ENABLED` is also on.
   */
  "auth.magic_link": define<boolean>({
    schema: z.boolean(),
    default: false,
    levels: ["platform", "partner"],
    turnOffOnly: true,
  }),
  /**
   * AI providers partners and customers may choose (CF6a): the platform
   * turns them on, the partner may only narrow them for its customers.
   */
  "ai.providers": define<AiProviderId[]>({
    schema: ProvidersSchema,
    default: [...AI_PROVIDERS],
    levels: ["platform", "partner"],
    narrow: narrowProviders,
  }),
  /**
   * Models allowed per provider (CF6a), the first one the default. The
   * partner may only narrow the platform's lists; an empty list on the
   * platform leaves the model free for that provider.
   */
  "ai.models": define<ModelCatalog>({
    schema: ModelCatalogSchema,
    default: DEFAULT_MODEL_CATALOG,
    levels: ["platform", "partner"],
    narrow: narrowCatalog,
  }),
  /**
   * Base URL of an OpenAI-compatible gateway per provider (CF6a), platform
   * only: https, called through the pinned fetch of the channels. Applies
   * to the text calls (conversation and key test).
   */
  "ai.base_urls": define<BaseUrls>({
    schema: BaseUrlsSchema,
    default: {},
    levels: ["platform"],
  }),
  /**
   * Emergency switch of the REST API of the workspaces (CF6b), platform
   * only: off, every call answers 503 in English; keys stay as they are.
   */
  "api.rest_enabled": define<boolean>({
    schema: z.boolean(),
    default: true,
    levels: ["platform"],
  }),
  /** Emergency switch of the workspace MCP (CF6b), platform only. */
  "api.mcp_enabled": define<boolean>({
    schema: z.boolean(),
    default: true,
    levels: ["platform"],
  }),
  /**
   * Scopes each plan allows the keys of its customers (CF6b), by plan key;
   * a plan without an entry allows every scope.
   */
  "api.plan_scopes": define<Record<string, WorkspaceScopeType[]>>({
    schema: PlanScopesSchema,
    default: {},
    levels: ["platform"],
  }),
  /**
   * Google scopes offered to the workspaces (CF6b): the platform turns them
   * on, the partner may only narrow them for its customers.
   */
  "integrations.google.scopes": define<GoogleScope[]>({
    schema: GoogleScopesSchema,
    default: [...GOOGLE_SCOPES],
    levels: ["platform", "partner"],
    narrow: narrowGoogleScopes,
  }),
  /**
   * Product analytics (CF7), off by default until the LGPD review
   * (D-PA-06). Platform only: the switch, the provider, its site
   * identifier (public: it goes to the browser) and PostHog's region.
   */
  "analytics.enabled": define<boolean>({
    schema: z.boolean(),
    default: false,
    levels: ["platform"],
  }),
  "analytics.provider": define<AnalyticsProvider>({
    schema: z.enum(ANALYTICS_PROVIDERS),
    default: "plausible",
    levels: ["platform"],
  }),
  "analytics.site_id": define<string | null>({
    schema: SiteIdSchema.nullable(),
    default: null,
    levels: ["platform"],
  }),
  "analytics.posthog_region": define<PosthogRegion>({
    schema: z.enum(POSTHOG_REGIONS),
    default: "us",
    levels: ["platform"],
  }),
  /**
   * The partner's own identifier for its brand (CF7, optional): login and
   * /app of its customers, same provider and consent as the platform, and
   * only while the platform's switch is on.
   */
  "analytics.partner_enabled": define<boolean>({
    schema: z.boolean(),
    default: false,
    levels: ["partner"],
  }),
  "analytics.partner_site_id": define<string | null>({
    schema: SiteIdSchema.nullable(),
    default: null,
    levels: ["partner"],
  }),
  /**
   * Base skills of the GMN agent (GB1a, especificação §8): switch and
   * autonomy per skill. Each level sets only the skills it changes; the
   * levels merge skill by skill and the platform default fills the rest.
   * The ficha level lives in the module (`gb_area_settings`).
   */
  "google_business.skills": define<Partial<Record<BaseSkill, SkillSetting>>>({
    schema: SkillSettingsSchema,
    default: {},
    levels: ["platform", "partner", "workspace"],
    narrow: mergeSkillSettings,
  }),
  /**
   * Ceiling of the GMN agent's autonomy (GB1a): the platform sets it, the
   * partner may only lower it for its customers; no skill goes above it.
   */
  "google_business.autonomy_ceiling": define<Autonomy>({
    schema: z.enum(AUTONOMY_LEVELS),
    default: "auto",
    levels: ["platform", "partner"],
    narrow: minAutonomy,
  }),
  /** Default triggers of the GMN agent (GB1a, especificação §8.5). */
  "google_business.triggers": define<TriggerSettings>({
    schema: TriggerSettingsSchema,
    default: DEFAULT_TRIGGER_SETTINGS,
    levels: ["platform", "partner", "workspace"],
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

/** True for switches the levels below may only turn off (CF5b). */
export function isTurnOffOnly(key: SettingKey): boolean {
  return (SETTINGS[key] as Definition<unknown>).turnOffOnly === true;
}

/** The narrowing function of a key the levels below may only narrow (CF6a). */
export function narrowOf(
  key: SettingKey,
): ((above: unknown, below: unknown) => unknown) | undefined {
  return (SETTINGS[key] as Definition<unknown>).narrow;
}

/** Keys a level may set. */
export function keysOfLevel(level: SettingLevel): SettingKey[] {
  return SETTING_KEYS.filter((key) =>
    (SETTINGS[key].levels as readonly SettingLevel[]).includes(level),
  );
}
