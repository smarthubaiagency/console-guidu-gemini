import "server-only";

import { decryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { ChatModelKey } from "./providers";

/**
 * Backup of the customer's key (A2c, especificação §9.2):
 *
 * - only a failure of the key or of the provider's limit starts it (code
 *   `provider_auth` or `provider_limit`); content or request errors do not;
 * - the platform key, with its cheap model, finishes only the conversations
 *   opened before the first failure, for up to 24 hours, as a courtesy that
 *   never counts for the customer (usage `backup`);
 * - 24 hours without a fix pause the agent (`ai-agents.key-watch`), and a
 *   successful key test ends the backup at once (`testGuidKey`).
 */

export const BACKUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Codes of `turnErrorCode` that start the backup. */
export function isKeyFailure(errorCode: string): boolean {
  return errorCode === "provider_auth" || errorCode === "provider_limit";
}

/** Whether the backup still serves a conversation at `now`. */
export function backupServes(
  conversationCreatedAt: Date,
  backupStartedAt: Date,
  now: Date,
): boolean {
  return (
    conversationCreatedAt.getTime() < backupStartedAt.getTime() &&
    now.getTime() < backupStartedAt.getTime() + BACKUP_WINDOW_MS
  );
}

/**
 * Marks the agent in backup at the first failure of its key. Returns when
 * the backup started and whether this call started it; null when the agent
 * is outside the context or its key already failed for good.
 */
export async function startKeyBackup(
  tx: ContextTransaction,
  agentId: string,
): Promise<Readonly<{ startedAt: Date; started: boolean }> | null> {
  const rows = await tx.$queryRaw<
    { backup_started_at: Date | null; started: boolean }[]
  >`select * from private.ai_agent_key_failed(${agentId}::uuid)`;
  const row = rows[0];
  return row?.backup_started_at
    ? { startedAt: row.backup_started_at, started: row.started }
    : null;
}

/** The platform key and its model, while the agent is in backup. */
export async function loadBackupKey(
  tx: ContextTransaction,
  agentId: string,
): Promise<ChatModelKey | null> {
  const rows = await tx.$queryRaw<
    { provider: string; encrypted_payload: string; model: string }[]
  >`select * from private.ai_backup_key(${agentId}::uuid)`;
  const row = rows[0];
  return row
    ? {
        provider: row.provider as AIProvider,
        secret: decryptSecret(row.encrypted_payload),
        model: row.model,
      }
    : null;
}
