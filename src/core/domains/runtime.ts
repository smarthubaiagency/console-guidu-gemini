import "server-only";

import { promises as dns } from "node:dns";

import type { PrismaClient } from "@prisma/client";

import { getRedis } from "@/lib/redis/client";
import { appLog } from "@/lib/telemetry/log";

import { cloudflareClient } from "./cloudflare";
import { domainsConfig } from "./config";
import { checkDomain, type DomainCheckResult } from "./verify";

/**
 * Server side of the custom domains (CF2b): the verification with the real
 * DNS and Cloudflare, the Cloudflare cleanup after a removal and the
 * ForwardAuth answer with its Redis cache.
 */

export async function verifyHost(
  host: string,
  current: Readonly<{ cloudflareHostnameId: string | null }>,
): Promise<DomainCheckResult> {
  const config = domainsConfig();
  return checkDomain(host, current, {
    cnameTarget: config.cnameTarget,
    cloudflare: config.cloudflare ? cloudflareClient(config.cloudflare) : null,
    resolveCname: (name) => dns.resolveCname(name),
  });
}

/** After a removal: the Cloudflare hostname goes too (best effort). */
export async function releaseHost(
  host: string,
  cloudflareHostnameId: string | null,
): Promise<void> {
  await invalidateDomainCheck(host);
  const config = domainsConfig();
  if (!cloudflareHostnameId || !config.cloudflare) return;
  try {
    await cloudflareClient(config.cloudflare).remove(cloudflareHostnameId);
  } catch (error) {
    appLog.error("domains.cloudflare_remove_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
}

// Same TTL as the legacy: a change reaches the proxy within 5 minutes, or
// at once when this process invalidates the key.
const CACHE_TTL_SECONDS = 300;
const cacheKey = (host: string) => `domain-check:${host}`;

export async function invalidateDomainCheck(host: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(cacheKey(host));
  } catch {
    // The entry expires on its own.
  }
}

/**
 * Whether the proxy may serve a host: an active custom domain of an active
 * partner or an active public domain of an active workspace. Fails closed:
 * any database error is a no.
 */
export async function isServedHost(
  client: PrismaClient,
  host: string,
): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey(host));
      if (cached === "1") return true;
      if (cached === "0") return false;
    } catch {
      // Redis down: ask the database.
    }
  }
  let served: boolean;
  try {
    const rows = await client.$queryRaw<Array<{ active: boolean }>>`
      select private.domain_host_active(${host}) as active
    `;
    served = rows[0]?.active === true;
  } catch (error) {
    appLog.error("domains.check_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
  if (redis) {
    try {
      await redis.set(
        cacheKey(host),
        served ? "1" : "0",
        "EX",
        CACHE_TTL_SECONDS,
      );
    } catch {
      // Without the cache the next request asks the database again.
    }
  }
  return served;
}

/** Workspace of an active public domain, for the public routes. */
export async function resolvePublicDomain(
  client: PrismaClient,
  host: string,
): Promise<{
  workspaceId: string;
  organizationId: string;
  slug: string;
} | null> {
  const rows = await client.$queryRaw<
    Array<{
      workspace_id: string;
      organization_id: string;
      workspace_slug: string;
    }>
  >`select * from private.resolve_public_domain(${host})`;
  const row = rows[0];
  return row
    ? {
        workspaceId: row.workspace_id,
        organizationId: row.organization_id,
        slug: row.workspace_slug,
      }
    : null;
}
