import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";

import {
  getMapsProvider,
  getPlaceLocator,
  type MapsIntelligenceProvider,
  type PlaceLocator,
} from "../../maps/provider";
import { getSuggestionsAi, type SuggestionsAi } from "./ai-engine";

/**
 * What the intelligence analyses need beyond the contract's context: a
 * transaction with the requester's context, the maps provider, the AI and
 * a clock. The contract (`../contract.ts`) gives only the request context,
 * so the runner of the analyses (GB1a) may wrap a run with its own
 * transactions, for example the short ones of a detached job in the worker:
 *
 *   runWithIntelligenceRuntime(
 *     { transaction: (_ctx, op) => session.transaction(op) },
 *     () => analysis.run(context),
 *   );
 *
 * Without a wrapper the analyses open `withContext` on the shared Prisma
 * client (the web's `DATABASE_URL`, app_runtime).
 */

export type IntelligenceRuntime = Readonly<{
  transaction<T>(
    ctx: RequestContext,
    operation: (tx: ContextTransaction) => Promise<T>,
  ): Promise<T>;
  maps: MapsIntelligenceProvider | null;
  locator: PlaceLocator | null;
  ai: SuggestionsAi | null;
  now: () => Date;
}>;

const storage = new AsyncLocalStorage<Partial<IntelligenceRuntime>>();

export function runWithIntelligenceRuntime<T>(
  runtime: Partial<IntelligenceRuntime>,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run(runtime, run);
}

export function currentRuntime(): IntelligenceRuntime {
  const given = storage.getStore() ?? {};
  return {
    transaction:
      given.transaction ??
      ((ctx, operation) => withContext(prisma, ctx, operation)),
    maps: given.maps === undefined ? getMapsProvider() : given.maps,
    locator: given.locator === undefined ? getPlaceLocator() : given.locator,
    ai: given.ai === undefined ? getSuggestionsAi() : given.ai,
    now: given.now ?? (() => new Date()),
  };
}
