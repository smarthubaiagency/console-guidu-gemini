import { normalizeHost } from "@/core/partners/hosts";

/**
 * Configuration of custom domains (CF2b), from the environment:
 *
 * - CUSTOM_DOMAIN_CNAME_TARGET: host every custom domain points to with a
 *   CNAME (the proxy). Without it, domains can be added but not verified.
 * - CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID: Cloudflare for SaaS, which
 *   issues the certificate of each custom hostname. Without them the proxy
 *   is expected to issue certificates itself and DNS alone activates.
 * - CLOUDFLARE_API_BASE: only for tests (fake API); defaults to Cloudflare.
 * - DOMAINS_CHECK_SECRET: shared secret of the Traefik ForwardAuth check.
 */
export type DomainsEnv = Readonly<{
  CUSTOM_DOMAIN_CNAME_TARGET?: string | undefined;
  CLOUDFLARE_API_TOKEN?: string | undefined;
  CLOUDFLARE_ZONE_ID?: string | undefined;
  CLOUDFLARE_API_BASE?: string | undefined;
  DOMAINS_CHECK_SECRET?: string | undefined;
}>;

export type CloudflareConfig = Readonly<{
  token: string;
  zoneId: string;
  apiBase: string;
}>;

export type DomainsConfig = Readonly<{
  cnameTarget: string | null;
  cloudflare: CloudflareConfig | null;
  checkSecret: string | null;
}>;

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export function domainsConfig(
  env: DomainsEnv = process.env as DomainsEnv,
): DomainsConfig {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
  const secret = env.DOMAINS_CHECK_SECRET?.trim();
  return {
    cnameTarget: normalizeHost(env.CUSTOM_DOMAIN_CNAME_TARGET),
    cloudflare:
      token && zoneId
        ? {
            token,
            zoneId,
            apiBase: env.CLOUDFLARE_API_BASE?.trim() || CLOUDFLARE_API,
          }
        : null,
    checkSecret: secret && secret.length >= 16 ? secret : null,
  };
}
