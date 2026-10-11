import { createHash } from "node:crypto";

import type { PermissionKey } from "@/core/permissions/catalog";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Contract of an operation an assistant may propose (F4d, §17.4). Writes
 * enter by explicit list: each module declares its operations, and the
 * core registry (`./registry.ts`) imports them. The services of the module
 * run the effect, so module state, permission and quota are checked again
 * when the approved proposal executes.
 */
export type ProposalOperation = Readonly<{
  /** `<module>.<object>.<verb>`, e.g. `crm.contacts.create`. */
  key: string;
  moduleKey: string;
  /** Shown to the approver, e.g. "Adicionar contato". */
  label: string;
  /** Role permission of the effect, checked on proposal, approval and run. */
  permission: PermissionKey;
  /** Operations on an existing record take its id and its version. */
  needsTarget: boolean;
  /** Fields of the payload, in display order, with their labels. */
  fields: readonly Readonly<{ key: string; label: string }>[];
  /** Workspace-relative path of the resulting record, for the screens. */
  resourcePath(resourceId: string): string;
  /** Validates and normalizes the payload; throws AppError on bad input. */
  parse(input: unknown): Record<string, unknown>;
  /** Current version of the target; throws not_found when it is gone. */
  version(
    tx: ContextTransaction,
    ctx: RequestContext,
    targetId: string,
  ): Promise<string>;
  /** Current values of the target, for the approval screen. */
  current(
    tx: ContextTransaction,
    ctx: RequestContext,
    targetId: string,
  ): Promise<Record<string, unknown>>;
  /** Runs the effect through the module services. */
  execute(
    tx: ContextTransaction,
    ctx: RequestContext,
    payload: Record<string, unknown>,
    targetId: string | null,
  ): Promise<{ resourceId: string }>;
}>;

/** JSON with object keys sorted at every level, so equal content hashes equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

export type HashedContent = Readonly<{
  workspaceId: string;
  operation: string;
  targetId: string | null;
  resourceVersion: string | null;
  payload: unknown;
}>;

/** SHA-256 of what a person approves: where, what, on which version. */
export function proposalHash(content: HashedContent): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        v: 1,
        workspaceId: content.workspaceId,
        operation: content.operation,
        targetId: content.targetId,
        resourceVersion: content.resourceVersion,
        payload: content.payload,
      }),
    )
    .digest("hex");
}
