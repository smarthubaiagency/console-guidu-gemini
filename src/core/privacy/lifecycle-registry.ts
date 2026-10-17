import { workspaceDomainsLifecycle } from "@/core/domains/lifecycle";
import { googleConnectionLifecycle } from "@/core/integrations/google/lifecycle";

import type {
  CoreLifecycleResource,
  WorkspaceLifecycleHooks,
} from "./contract";
import { listModuleDataContracts } from "./registry";

/**
 * Lifecycle hooks of the workspace deletion (WS1): the modules' (from
 * their data contracts) and the core's, by explicit import. A new core
 * resource is one line in `CORE_RESOURCES`; a module adds the hooks to its
 * data contract. They run in this order: modules first, then the core.
 */
const CORE_RESOURCES: readonly CoreLifecycleResource[] = [
  googleConnectionLifecycle(),
  workspaceDomainsLifecycle(),
];

export type NamedLifecycleHooks = Readonly<{ key: string }> &
  WorkspaceLifecycleHooks;

export function listLifecycleHooks(): readonly NamedLifecycleHooks[] {
  return [
    ...listModuleDataContracts().map((contract): NamedLifecycleHooks => ({
      key: `module.${contract.moduleKey}`,
      ...(contract.onDeletionScheduled
        ? { onDeletionScheduled: contract.onDeletionScheduled.bind(contract) }
        : {}),
      ...(contract.onDeletionCanceled
        ? { onDeletionCanceled: contract.onDeletionCanceled.bind(contract) }
        : {}),
      ...(contract.purgeExternal
        ? { purgeExternal: contract.purgeExternal.bind(contract) }
        : {}),
    })),
    ...CORE_RESOURCES,
  ];
}
