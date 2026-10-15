import "server-only";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import { PATH_HEADER } from "@/core/i18n/path";
import { AppError } from "@/shared/errors";

import { maintenanceStatus } from "./runtime";
import { activeMode, isClosedPath } from "./state";

/**
 * The door of the maintenance window (CF5c) for pages and server actions.
 * `requireUser` and `requireMfa` call it, and every page, route and action
 * of /app and /admin goes through one of them (guard-coverage.test.ts), so
 * no screen can forget it. It reads the path the proxy stamps
 * (`x-guidu-path`) and, for an action, the `Next-Action` header:
 *
 * - full maintenance: a page goes to /maintenance, an action fails with
 *   the maintenance message in the SmartStatusBanner;
 * - read-only: pages open, actions fail with the read-only message.
 *
 * /platform, /app/account/security and everything outside /app, /admin and
 * the invitations pass (`isClosedPath`). Outside a request (worker, tests)
 * there is nothing to close.
 */

export const MAINTENANCE_PAGE = "/maintenance";

export function maintenanceClosedError(): AppError {
  return new AppError({
    code: "unavailable",
    safeMessage: "O sistema está em manutenção. Tente novamente mais tarde.",
    messageKey: "maintenance.errors.closed",
  });
}

export function maintenanceReadOnlyError(): AppError {
  return new AppError({
    code: "unavailable",
    safeMessage:
      "O sistema está em modo somente leitura durante a manutenção. Nenhuma alteração foi salva.",
    messageKey: "maintenance.errors.readOnly",
  });
}

async function requestFacts(): Promise<{
  path: string | null;
  action: boolean;
} | null> {
  try {
    const list = await headers();
    return {
      path: list.get(PATH_HEADER),
      action: list.get("next-action") !== null,
    };
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

export async function enforceMaintenance(): Promise<void> {
  const facts = await requestFacts();
  if (!facts || !isClosedPath(facts.path)) return;
  const mode = activeMode(await maintenanceStatus());
  if (mode === "maintenance") {
    if (facts.action) throw maintenanceClosedError();
    redirect(MAINTENANCE_PAGE);
  }
  if (mode === "read_only" && facts.action) {
    throw maintenanceReadOnlyError();
  }
}
