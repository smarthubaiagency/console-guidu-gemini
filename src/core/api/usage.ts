import type { PrismaClient } from "@prisma/client";

import { withContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";

/**
 * Usage per API key (CF6b): one call, and whether it failed (status 400 or
 * above), counted per day and surface by `private.record_api_key_usage`
 * in the key's own context. A failure to count never fails the call.
 */

export type KeyUsageSubject = Readonly<{
  apiKeyId: string;
  userId: string;
  workspaceId: string;
  organizationId: string;
}>;

export async function recordApiKeyUsage(
  prisma: PrismaClient,
  subject: KeyUsageSubject,
  surface: "api" | "mcp",
  failed: boolean,
): Promise<void> {
  try {
    await withContext(
      prisma,
      {
        userId: subject.userId,
        workspaceId: subject.workspaceId,
        organizationId: subject.organizationId,
        principalType: "api_key",
        grantId: subject.apiKeyId,
      },
      (tx) =>
        tx.$executeRaw`select private.record_api_key_usage(${surface}, ${failed})`,
    );
  } catch (error) {
    appLog.warn("api.usage_record_failed", {
      surface,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
}
