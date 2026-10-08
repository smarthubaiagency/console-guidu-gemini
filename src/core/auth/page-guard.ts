import "server-only";
import { redirect } from "next/navigation";

import { isAccessDeniedError } from "./errors";
import { requireMfa, requireUser, type Identity } from "./identity";

/**
 * Page-level wrappers around the server guards.
 *
 * Route Handlers answer 401/403; pages have to send the browser to the state
 * that explains the denial. Both go through the same `decideAccess` rules — a
 * page is never the thing that decides.
 */
async function guardPage(
  guard: () => Promise<Identity>,
  currentPath: string,
): Promise<Identity> {
  try {
    return await guard();
  } catch (error) {
    if (isAccessDeniedError(error)) redirect(error.route(currentPath));
    throw error;
  }
}

export function requireUserPage(currentPath: string): Promise<Identity> {
  return guardPage(requireUser, currentPath);
}

export function requireMfaPage(currentPath: string): Promise<Identity> {
  return guardPage(requireMfa, currentPath);
}
