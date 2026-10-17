import type { CoreLifecycleResource } from "@/core/privacy/contract";

import {
  type CloudflareClient,
  CloudflareError,
  cloudflareClient,
} from "./cloudflare";
import { domainsConfig } from "./config";

/**
 * The custom hostnames of a workspace's public domains at its final purge
 * (WS1): each one is removed from Cloudflare for SaaS before the database
 * purge deletes the domains. Idempotent: a hostname Cloudflare no longer
 * has (404) counts as removed, and without Cloudflare configured there is
 * nothing to remove. The worker reads the domains of a workspace past its
 * grace period only (`workspace_domains_worker_purge_select`).
 */
export function workspaceDomainsLifecycle(
  deps: Readonly<{ client?: CloudflareClient | null }> = {},
): CoreLifecycleResource {
  return {
    key: "core.workspace_domains",
    async purgeExternal(workspaceId, io) {
      const domains = await io.transaction(
        (tx) =>
          tx.$queryRaw<{ id: string; cloudflare_hostname_id: string | null }[]>`
          select id, cloudflare_hostname_id
          from public.workspace_domains
          where workspace_id = ${workspaceId}::uuid
            and cloudflare_hostname_id is not null
          order by id
        `,
      );
      if (domains.length === 0) return { removed: 0, alreadyGone: 0 };
      const config = domainsConfig().cloudflare;
      const client =
        deps.client !== undefined
          ? deps.client
          : config
            ? cloudflareClient(config)
            : null;
      if (!client) return { removed: 0, alreadyGone: 0, cloudflare: "off" };
      let removed = 0;
      let alreadyGone = 0;
      for (const domain of domains) {
        try {
          await client.remove(domain.cloudflare_hostname_id!);
          removed += 1;
        } catch (error) {
          if (error instanceof CloudflareError && error.status === 404) {
            alreadyGone += 1;
            continue;
          }
          throw error;
        }
      }
      return { removed, alreadyGone };
    },
  };
}
