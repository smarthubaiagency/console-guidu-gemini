import {
  normalizeHost,
  partnerSubdomainBase,
  platformHosts,
  type PlatformHostEnv,
} from "@/core/partners/hosts";

/**
 * Default public domains (CF2c, plano-cf2c.md): pure rules shared by the
 * screens, the proxy check and the future public routes (DP1a).
 *
 * Every public route type has a default domain on the platform; a partner
 * may replace it for its customers with its own (`partner_public_domains`).
 * Each workspace answers on `{workspace slug}.{default domain}`; the path
 * after it (`/{slug}`) belongs to the tool.
 */

export const PUBLIC_ROUTE_TYPES = ["profile", "quiz", "page"] as const;
export type PublicRouteType = (typeof PUBLIC_ROUTE_TYPES)[number];

export function isPublicRouteType(value: unknown): value is PublicRouteType {
  return (
    typeof value === "string" &&
    (PUBLIC_ROUTE_TYPES as readonly string[]).includes(value)
  );
}

/** Platform defaults when the environment says nothing (Marcelo, 15/10/2026). */
export const DEFAULT_PLATFORM_PUBLIC_BASES: Readonly<
  Record<PublicRouteType, string>
> = {
  profile: "mobio.pro",
  quiz: "quiz.mobio.pro",
  page: "mobio.page",
};

export type PublicBasesEnv = PlatformHostEnv &
  Readonly<{
    PUBLIC_DOMAIN_PROFILE?: string | undefined;
    PUBLIC_DOMAIN_QUIZ?: string | undefined;
    PUBLIC_DOMAIN_PAGE?: string | undefined;
  }>;

const ENV_KEYS: Readonly<Record<PublicRouteType, keyof PublicBasesEnv>> = {
  profile: "PUBLIC_DOMAIN_PROFILE",
  quiz: "PUBLIC_DOMAIN_QUIZ",
  page: "PUBLIC_DOMAIN_PAGE",
};

/**
 * Platform default domain of each type: the variable when set (an empty or
 * invalid value turns the type off), else the default above. A domain that
 * is a platform host or sits under the partner subdomain base is dropped:
 * those hosts serve the dashboard.
 */
export function platformPublicBases(
  env: PublicBasesEnv = process.env as PublicBasesEnv,
): Readonly<Record<PublicRouteType, string | null>> {
  const dashboard = platformHosts(env);
  const partnerBase = partnerSubdomainBase(env);
  const result = {} as Record<PublicRouteType, string | null>;
  for (const type of PUBLIC_ROUTE_TYPES) {
    const raw = env[ENV_KEYS[type]];
    const host =
      raw === undefined
        ? DEFAULT_PLATFORM_PUBLIC_BASES[type]
        : normalizeHost(raw);
    const clash =
      !host ||
      !host.includes(".") ||
      dashboard.has(host) ||
      (partnerBase !== null &&
        (host === partnerBase || host.endsWith(`.${partnerBase}`)));
    result[type] = clash ? null : host;
  }
  return result;
}

/** Whether `host` is `base` or a host under it. */
export function isUnder(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/**
 * Labels that never name a workspace under a default domain: they belong to
 * the infrastructure or would read as the platform's own pages.
 */
export const RESERVED_LABELS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "autoconfig",
  "autodiscover",
  "blog",
  "cdn",
  "console",
  "dashboard",
  "dev",
  "docs",
  "ftp",
  "help",
  "imap",
  "login",
  "mail",
  "mcp",
  "mx",
  "ns1",
  "ns2",
  "painel",
  "platform",
  "pop",
  "proxy",
  "smtp",
  "staging",
  "static",
  "status",
  "suporte",
  "support",
  "webmail",
  "www",
]);

const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Default host of a workspace under `base`, or null when the slug cannot be
 * a subdomain there: not a DNS label, reserved, or the resulting host is
 * another default domain (`quiz` under `mobio.pro` is the quiz domain).
 */
export function workspaceDefaultHost(
  workspaceSlug: string,
  base: string | null,
  allBases: readonly string[],
): string | null {
  if (!base) return null;
  const label = workspaceSlug.toLowerCase();
  if (!DNS_LABEL.test(label) || RESERVED_LABELS.has(label)) return null;
  const host = `${label}.${base}`;
  if (host.length > 253 || allBases.includes(host)) return null;
  return host;
}

/** The host and each parent with two labels or more, longest first. */
export function hostSuffixes(host: string): string[] {
  const labels = host.split(".");
  const result: string[] = [];
  for (let i = 0; i <= labels.length - 2; i += 1) {
    result.push(labels.slice(i).join("."));
  }
  return result;
}

export type PublicBase = Readonly<{
  host: string;
  routeType: PublicRouteType;
  /** Null for the platform's own default domain. */
  partnerId: string | null;
}>;

export type PublicWorkspace = Readonly<{
  workspaceId: string;
  organizationId: string;
  workspaceSlug: string;
  partnerId: string;
  /** Route types whose platform domain the partner replaced. */
  replacedTypes: readonly string[];
}>;

export type PublicHostResolution =
  | Readonly<{
      kind: "custom";
      host: string;
      workspaceId: string;
      organizationId: string;
      workspaceSlug: string;
      /** Tools that chose this domain; the others use their default. */
      tools: ReadonlyArray<{ toolKey: string; routeType: string }>;
    }>
  | Readonly<{
      kind: "default";
      host: string;
      routeType: PublicRouteType;
      partnerId: string | null;
      workspaceId: string;
      organizationId: string;
      workspaceSlug: string;
    }>
  | Readonly<{
      /** The default domain itself, without a workspace. */
      kind: "base";
      host: string;
      routeType: PublicRouteType;
      partnerId: string | null;
    }>;

export type PublicHostLookup = Readonly<{
  platformBases: Readonly<Record<PublicRouteType, string | null>>;
  /** Hosts that serve the dashboard (never public). */
  dashboardHosts: ReadonlySet<string>;
  customDomain(host: string): Promise<{
    workspaceId: string;
    organizationId: string;
    workspaceSlug: string;
    tools: ReadonlyArray<{ toolKey: string; routeType: string }>;
  } | null>;
  partnerBases(hosts: readonly string[]): Promise<readonly PublicBase[]>;
  workspaceBySlug(slug: string): Promise<PublicWorkspace | null>;
}>;

/**
 * Maps a request host to what it serves. Order: dashboard hosts are never
 * public; an active own domain of an active workspace; else the longest
 * default domain (platform or active partner) the host ends with. The host
 * equal to it is the type's root; one label before it must be the slug of
 * an active workspace that the domain serves: on a partner domain, a
 * customer of that partner; on the platform domain, a workspace whose
 * partner did not replace that type. Anything else is unknown (null).
 */
export async function resolvePublicHostWith(
  rawHost: string | null | undefined,
  lookup: PublicHostLookup,
): Promise<PublicHostResolution | null> {
  const host = normalizeHost(rawHost);
  if (!host || !host.includes(".") || lookup.dashboardHosts.has(host)) {
    return null;
  }

  const custom = await lookup.customDomain(host);
  if (custom) return { kind: "custom", host, ...custom };

  const suffixes = hostSuffixes(host);
  const bases: PublicBase[] = [];
  for (const type of PUBLIC_ROUTE_TYPES) {
    const base = lookup.platformBases[type];
    if (base && suffixes.includes(base)) {
      bases.push({ host: base, routeType: type, partnerId: null });
    }
  }
  bases.push(...(await lookup.partnerBases(suffixes)));
  if (bases.length === 0) return null;
  // Longest first: `rodobens.quiz.mobio.pro` is quiz, not profile.
  const base = bases.reduce((best, next) =>
    next.host.length > best.host.length ? next : best,
  );

  if (host === base.host) {
    return {
      kind: "base",
      host,
      routeType: base.routeType,
      partnerId: base.partnerId,
    };
  }
  const label = host.slice(0, -(base.host.length + 1));
  const allBases = [
    ...Object.values(lookup.platformBases).filter(
      (value): value is string => value !== null,
    ),
    ...bases.map((b) => b.host),
  ];
  if (workspaceDefaultHost(label, base.host, allBases) !== host) return null;

  const workspace = await lookup.workspaceBySlug(label);
  if (!workspace) return null;
  const served =
    base.partnerId === null
      ? !workspace.replacedTypes.includes(base.routeType)
      : workspace.partnerId === base.partnerId;
  if (!served) return null;
  return {
    kind: "default",
    host,
    routeType: base.routeType,
    partnerId: base.partnerId,
    workspaceId: workspace.workspaceId,
    organizationId: workspace.organizationId,
    workspaceSlug: workspace.workspaceSlug,
  };
}

/**
 * Effective default domain of each type for a workspace: the partner's
 * active domain of the type when there is one, else the platform's.
 */
export function effectivePublicBases(
  platform: Readonly<Record<PublicRouteType, string | null>>,
  partner: ReadonlyArray<{ routeType: string; host: string }>,
): Record<
  PublicRouteType,
  { host: string | null; source: "platform" | "partner" }
> {
  const result = {} as Record<
    PublicRouteType,
    { host: string | null; source: "platform" | "partner" }
  >;
  for (const type of PUBLIC_ROUTE_TYPES) {
    const own = partner.find((row) => row.routeType === type);
    result[type] = own
      ? { host: own.host, source: "partner" }
      : { host: platform[type], source: "platform" };
  }
  return result;
}
