import { decryptSecret } from "@/core/credentials/crypto";
import type { CoreLifecycleResource } from "@/core/privacy/contract";

import { isFakeGoogleProvider, revokeGoogleTokenStrict } from "./provider";

/**
 * The Google account of a workspace at its final purge (WS1): the token is
 * revoked at Google before the database purge deletes the row. Idempotent:
 * no row, or a token Google no longer knows, counts as done. The worker
 * reads the encrypted tokens of a workspace past its grace period only
 * (`workspace_google_connections_worker_purge_select`). With the fake
 * provider (tests and e2e) nothing leaves the process.
 */
export function googleConnectionLifecycle(
  deps: Readonly<{
    revoke?: (token: string) => Promise<"revoked" | "already_gone">;
    env?: Readonly<Record<string, string | undefined>>;
  }> = {},
): CoreLifecycleResource {
  return {
    key: "core.google_connection",
    async purgeExternal(workspaceId, io) {
      const rows = await io.transaction(
        (tx) =>
          tx.$queryRaw<
            {
              access_token_encrypted: string;
              refresh_token_encrypted: string | null;
            }[]
          >`
          select access_token_encrypted, refresh_token_encrypted
          from public.workspace_google_connections
          where workspace_id = ${workspaceId}::uuid
        `,
      );
      const row = rows[0];
      if (!row) return { revoked: "none" };
      if (!deps.revoke && isFakeGoogleProvider(deps.env ?? process.env)) {
        return { revoked: "fake" };
      }
      let token: string;
      try {
        token = decryptSecret(
          row.refresh_token_encrypted ?? row.access_token_encrypted,
        );
      } catch {
        // A token that no key opens can never be used again.
        return { revoked: "unreadable" };
      }
      const outcome = await (deps.revoke ?? revokeGoogleTokenStrict)(token);
      return { revoked: outcome };
    },
  };
}
