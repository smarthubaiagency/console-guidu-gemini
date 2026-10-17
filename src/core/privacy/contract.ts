import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/**
 * Data contract of a module (Especificação §15 and §19, F3e): what the
 * module exports for a workspace and how its rows are purged when the
 * workspace is deleted. Every module that declares the `export` capability
 * registers one in src/core/privacy/registry.ts.
 *
 * - `export` runs in the requester's context as app_runtime, so RLS and the
 *   module's own rules decide what is visible. It returns plain JSON: ids,
 *   texts and dates; never secrets or credentials.
 * - `purge` runs as app_worker for a workspace past its grace period; the
 *   database lets it delete only those rows.
 *
 * Lifecycle hooks (WS1), all optional, for what lives outside the rows the
 * purge deletes (rooms of another server, tokens at a provider, hostnames
 * at a CDN). See `WorkspaceLifecycleHooks`.
 */
export type ExportedRows = readonly Readonly<Record<string, unknown>>[];

/** Small summary a hook may return; kept in the deletion record. */
export type HookOutcome = Readonly<
  Record<string, string | number | boolean | null>
> | void;

/** Short app_worker transactions for a hook that runs outside one. */
export type ExternalPurgeIO = Readonly<{
  transaction<T>(operation: (tx: ContextTransaction) => Promise<T>): Promise<T>;
}>;

/**
 * Hooks of the workspace deletion (WS1), run by the worker as app_worker.
 * The result of each one is recorded in `workspace_deletions.lifecycle`.
 *
 * - `onDeletionScheduled`: the workspace has just closed (every service of
 *   it stops); e.g. take the attendants out of its rooms. Runs in its own
 *   short transaction; retried until it succeeds or the attempts run out.
 * - `onDeletionCanceled`: the owner canceled within the grace period; undo
 *   what the scheduled hook did.
 * - `purgeExternal`: the grace period is over. Runs before the database
 *   purge and outside any transaction (it reads what it needs through
 *   `io`), must be idempotent and treat "already gone" as success; it is
 *   retried on failure, and the database purge happens only after every
 *   external hook succeeded.
 */
export type WorkspaceLifecycleHooks = Readonly<{
  onDeletionScheduled?(
    tx: ContextTransaction,
    workspaceId: string,
  ): Promise<HookOutcome>;
  onDeletionCanceled?(
    tx: ContextTransaction,
    workspaceId: string,
  ): Promise<HookOutcome>;
  purgeExternal?(
    workspaceId: string,
    io: ExternalPurgeIO,
  ): Promise<HookOutcome>;
}>;

export type ModuleDataContract = Readonly<{
  moduleKey: string;
  export(
    tx: ContextTransaction,
    ctx: RequestContext,
  ): Promise<Readonly<Record<string, ExportedRows>>>;
  purge(
    tx: ContextTransaction,
    workspaceId: string,
  ): Promise<Readonly<Record<string, number>>>;
}> &
  WorkspaceLifecycleHooks;

/**
 * A resource of the core (not of a module) with lifecycle hooks, listed in
 * src/core/privacy/lifecycle-registry.ts: the Google account, the custom
 * hostnames and, from the IN3, the Matrix rooms.
 */
export type CoreLifecycleResource = Readonly<{
  /** `core.<name>`; the key of its results in the deletion record. */
  key: string;
}> &
  WorkspaceLifecycleHooks;
