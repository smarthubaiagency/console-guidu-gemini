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
 */
export type ExportedRows = readonly Readonly<Record<string, unknown>>[];

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
}>;
