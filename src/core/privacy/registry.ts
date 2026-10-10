import { aiAgentsDataContract } from "@/modules/ai-agents/data";
import { helloWorldDataContract } from "@/modules/hello-world/data";

import type { ModuleDataContract } from "./contract";

/**
 * Data contracts of the modules in this build, by explicit import (F3e).
 * A module with the `export` capability must be listed here; the registry
 * test keeps both in step.
 */
const CONTRACTS: readonly ModuleDataContract[] = [
  aiAgentsDataContract,
  helloWorldDataContract,
];

export function listModuleDataContracts(): readonly ModuleDataContract[] {
  return CONTRACTS;
}
