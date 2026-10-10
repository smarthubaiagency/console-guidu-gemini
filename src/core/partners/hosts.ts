/**
 * Host helpers for partner resolution (ADR 0012: the host selects the
 * partner, the route selects the role).
 *
 * The `Host` header is client-supplied. That is acceptable here because it
 * only selects which partner's slice the request sees; membership and RLS
 * still decide what the identity can read. `X-Forwarded-Host` is never used.
 * Platform hosts come only from operator-controlled configuration.
 */

const HOSTNAME =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1"] as const;

/**
 * Lowercased hostname without port, or null when the value is not a plain
 * DNS hostname (IPv6 literals, credentials, paths and empty values included).
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value || value.length > 260) return null;

  const hostname = value.replace(/:\d{1,5}$/, "").replace(/\.$/, "");
  if (hostname.length === 0 || hostname.length > 253) return null;
  return HOSTNAME.test(hostname) ? hostname : null;
}

export type PlatformHostEnv = Readonly<{
  APP_URL?: string | undefined;
  PLATFORM_HOSTS?: string | undefined;
  PARTNER_SUBDOMAIN_BASE?: string | undefined;
  NODE_ENV?: string | undefined;
}>;

/**
 * Hosts that serve the platform itself: the host of APP_URL, every entry of
 * the comma-separated PLATFORM_HOSTS and, outside production, the loopback
 * names. All of them resolve to the house partner.
 */
export function platformHosts(env: PlatformHostEnv): ReadonlySet<string> {
  const hosts = new Set<string>();

  const appUrl = env.APP_URL?.trim();
  if (appUrl) {
    try {
      const host = normalizeHost(new URL(appUrl).host);
      if (host) hosts.add(host);
    } catch {
      // An invalid APP_URL is rejected by appConfig; nothing to add here.
    }
  }

  for (const entry of (env.PLATFORM_HOSTS ?? "").split(",")) {
    const host = normalizeHost(entry);
    if (host) hosts.add(host);
  }

  if (env.NODE_ENV !== "production") {
    for (const host of LOOPBACK_HOSTS) hosts.add(host);
  }

  return hosts;
}

/**
 * Origin for links on a partner host. Production always uses https. Outside
 * production the scheme and port of APP_URL are reused, so a development
 * domain such as `agencia.localhost` works on `http://…:3000`.
 */
export function partnerHostOrigin(host: string, env: PlatformHostEnv): string {
  if (env.NODE_ENV === "production") return `https://${host}`;
  try {
    const app = new URL(env.APP_URL ?? "");
    return `${app.protocol}//${host}${app.port ? `:${app.port}` : ""}`;
  } catch {
    return `https://${host}`;
  }
}

const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Base domain of platform subdomains (`<parceiro>.<base>`, ADR 0012):
 * PARTNER_SUBDOMAIN_BASE, or `localhost` outside production. Null when
 * production has none configured.
 */
export function partnerSubdomainBase(env: PlatformHostEnv): string | null {
  const configured = normalizeHost(env.PARTNER_SUBDOMAIN_BASE);
  if (configured) return configured;
  return env.NODE_ENV === "production" ? null : "localhost";
}

/**
 * Host of a platform subdomain from what the operator typed: just the name
 * (`agencia`) or the full host already under the base
 * (`agencia.guidu.com.br`). Null when it is neither.
 */
export function subdomainHost(input: string, base: string): string | null {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  const label = value.endsWith(`.${base}`)
    ? value.slice(0, -(base.length + 1))
    : value;
  return DNS_LABEL.test(label) ? `${label}.${base}` : null;
}
