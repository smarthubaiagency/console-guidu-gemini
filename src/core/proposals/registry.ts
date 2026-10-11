import { crmProposalOperations } from "@/modules/crm/proposals";

import type { ProposalOperation } from "./operation";

/**
 * Operations an assistant may propose, by explicit import (§17.4: writes
 * enter by explicit list). Adding one is a code change with its tests.
 */
const OPERATIONS: readonly ProposalOperation[] = [...crmProposalOperations];

const BY_KEY: ReadonlyMap<string, ProposalOperation> = new Map(
  OPERATIONS.map((op) => [op.key, op]),
);

if (BY_KEY.size !== OPERATIONS.length) {
  throw new Error("Duplicated proposal operation in the registry");
}

export function listProposalOperations(): readonly ProposalOperation[] {
  return OPERATIONS;
}

export function getProposalOperation(key: string): ProposalOperation | null {
  return BY_KEY.get(key) ?? null;
}
