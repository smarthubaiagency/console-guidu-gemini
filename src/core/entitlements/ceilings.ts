import "server-only";

import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  type Ceilings,
  findQuotaEntry,
  type LimitProblem,
  listQuotaEntries,
  validatePlanLimits,
} from "./catalog";

/**
 * Platform ceilings of the quotas (CF4, `public.quota_ceilings`). A key
 * without a row has no ceiling. Readable by any signed-in context; the
 * writes live in `src/core/billing/limits.ts`.
 */

export async function loadCeilings(tx: ContextTransaction): Promise<Ceilings> {
  const rows = await tx.quotaCeiling.findMany({
    select: { quotaKey: true, ceiling: true },
  });
  return new Map(rows.map((row) => [row.quotaKey, row.ceiling]));
}

/** Portuguese label of a key, for the safe message of an error. */
export function quotaFallbackLabel(key: string): string {
  return findQuotaEntry(key)?.label ?? key;
}

/** The error of the first problem of a plan's limits. */
export function planLimitError(problem: LimitProblem): AppError {
  const quota = quotaFallbackLabel(problem.key);
  switch (problem.reason) {
    case "unknown":
      return new AppError({
        code: "invalid_input",
        safeMessage: "Limite de cota desconhecida no plano.",
        messageKey: "billing.errors.unknownQuota",
      });
    case "invalid":
      return new AppError({
        code: "invalid_input",
        safeMessage: `${quota}: use um número inteiro de 0 a 1.000.000.`,
        messageKey: "plans.errors.invalidValue",
        messageValues: { quota, quotaKey: problem.key },
      });
    case "above_ceiling":
      return new AppError({
        code: "invalid_input",
        safeMessage: `${quota}: o valor passa do teto da plataforma (${problem.ceiling}).`,
        messageKey: "plans.errors.aboveCeiling",
        messageValues: {
          quota,
          quotaKey: problem.key,
          ceiling: problem.ceiling ?? 0,
        },
      });
    case "unlimited_not_allowed":
      return problem.ceiling === undefined
        ? new AppError({
            code: "invalid_input",
            safeMessage: `${quota}: este limite precisa de um número.`,
            messageKey: "plans.errors.unlimitedNotAccepted",
            messageValues: { quota, quotaKey: problem.key },
          })
        : new AppError({
            code: "invalid_input",
            safeMessage: `${quota}: "sem limite" não cabe no teto da plataforma (${problem.ceiling}).`,
            messageKey: "plans.errors.unlimitedUnderCeiling",
            messageValues: {
              quota,
              quotaKey: problem.key,
              ceiling: problem.ceiling,
            },
          });
  }
}

/**
 * Refuses limits of a plan version outside the catalog or the ceilings.
 * The database repeats the ceiling rule (`plan_versions_check_limits`).
 */
export async function assertPlanLimits(
  tx: ContextTransaction,
  limits: Readonly<Record<string, unknown>>,
): Promise<void> {
  const problems = validatePlanLimits(
    limits,
    listQuotaEntries(),
    await loadCeilings(tx),
  );
  const first = problems[0];
  if (first) throw planLimitError(first);
}
