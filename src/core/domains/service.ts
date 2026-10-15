import { recordAudit } from "@/core/audit/record";
import { assertWithinQuota, resolveQuota } from "@/core/entitlements/quotas";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  PermissionDeniedError,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  isPartnerRole,
} from "@/core/permissions/matrix";
import {
  normalizeHost,
  partnerSubdomainBase,
  platformHosts,
} from "@/core/partners/hosts";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { domainsConfig } from "./config";
import { isUnder, platformPublicBases } from "./public-hosts";
import { PUBLIC_DOMAINS_DEFAULT_LIMIT, PUBLIC_DOMAINS_QUOTA } from "./quota";
import type { DomainCheckResult } from "./verify";

/**
 * Custom domains (CF2b, plano-dominios.md). Two kinds:
 *
 * - the dashboard domain of a partner (`partner_domains`, kind custom),
 *   managed by the partner owner/admin in /admin;
 * - the public domains of a workspace (`workspace_domains`), managed by the
 *   workspace owner/admin in /app and by the partner owner/admin of the
 *   company in /admin, within the plan's quota.
 *
 * Every function runs in the actor's transaction; RLS repeats the checks.
 * Network work (DNS, Cloudflare) happens outside, in the actions.
 */

export type DomainView = Readonly<{
  id: string;
  host: string;
  kind: "subdomain" | "custom";
  status: string;
  sslStatus: string;
  isPrimary: boolean;
  lastError: string | null;
  checkedAt: Date | null;
}>;

export type PartnerDomainActor = Readonly<{
  userId: string;
  partnerId: string;
  partnerRole: string | null;
}>;

/** Who manages public domains: the workspace itself or its partner. */
export type WorkspaceDomainActor =
  | Readonly<{ kind: "workspace"; userId: string; ctx: RequestContext }>
  | Readonly<{
      kind: "partner";
      userId: string;
      partnerId: string;
      partnerRole: string | null;
    }>;

export type WorkspaceRef = Readonly<{
  workspaceId: string;
  organizationId: string;
}>;

function invalid(message: string, key: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `domains.errors.${key}`,
  });
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Domínio não encontrado.",
    messageKey: "domains.errors.notFound",
  });
}

/**
 * Host typed by a manager: protocol, path and port are dropped. Refused when
 * it is not a domain with a dot, belongs to the platform, sits under the
 * partner subdomain base, is the CNAME target itself or sits under a
 * platform default public domain (CF2c; workspace subdomains live there).
 * Hosts under a partner's default domain are refused by the database.
 */
export function parseCustomHost(input: string): string {
  const raw = input
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#]/)[0];
  const host = normalizeHost(raw);
  if (!host || !host.includes(".")) {
    throw invalid(
      "Informe um domínio válido, como perfil.suaempresa.com.br.",
      "invalidDomain",
    );
  }
  const config = domainsConfig();
  const base = partnerSubdomainBase(process.env);
  if (
    platformHosts(process.env).has(host) ||
    (base && (host === base || host.endsWith(`.${base}`))) ||
    (config.cnameTarget &&
      (host === config.cnameTarget ||
        host.endsWith(`.${config.cnameTarget}`))) ||
    Object.values(platformPublicBases()).some(
      (publicBase) => publicBase !== null && isUnder(host, publicBase),
    )
  ) {
    throw invalid("Esse domínio pertence à plataforma.", "platformDomain");
  }
  return host;
}

async function assertHostFree(
  tx: ContextTransaction,
  host: string,
): Promise<void> {
  // RLS hides other partners' rows; the trigger checks every row, so a
  // taken host still fails on insert with the same message.
  const [partner, workspace] = await Promise.all([
    tx.partnerDomain.findUnique({ where: { host }, select: { host: true } }),
    tx.workspaceDomain.findUnique({ where: { host }, select: { id: true } }),
  ]);
  if (partner || workspace) throw hostTaken();
}

function hostTaken(): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: "Esse domínio já está cadastrado.",
    messageKey: "domains.errors.taken",
  });
}

/** A unique violation of the host (column or cross-table trigger). */
function isHostConflict(error: unknown): boolean {
  const text = error instanceof Error ? error.message : "";
  return (
    (error as { code?: string } | null)?.code === "P2002" ||
    /unique|domain host already in use/i.test(text)
  );
}

// ----------------------------------------------------------------------------
// Partner dashboard domains
// ----------------------------------------------------------------------------

export function canManagePartnerDomains(actor: PartnerDomainActor): boolean {
  return Boolean(
    actor.partnerRole &&
    isPartnerRole(actor.partnerRole) &&
    hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_SETTINGS_MANAGE,
    ),
  );
}

function requirePartnerManager(actor: PartnerDomainActor): void {
  if (!canManagePartnerDomains(actor)) throw new PermissionDeniedError();
}

export async function listPartnerDomains(
  tx: ContextTransaction,
  partnerId: string,
): Promise<DomainView[]> {
  const rows = await tx.partnerDomain.findMany({
    where: { partnerId },
    orderBy: [{ kind: "desc" }, { host: "asc" }],
  });
  return rows.map((row) => ({
    id: row.host,
    host: row.host,
    kind: row.kind === "subdomain" ? "subdomain" : "custom",
    status: row.status,
    sslStatus: row.sslStatus,
    isPrimary: false,
    lastError: row.lastError,
    checkedAt: row.checkedAt,
  }));
}

export async function addPartnerCustomDomain(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  input: string,
): Promise<{ host: string }> {
  requirePartnerManager(actor);
  const host = parseCustomHost(input);
  await assertHostFree(tx, host);
  try {
    await tx.partnerDomain.create({
      data: {
        host,
        partnerId: actor.partnerId,
        kind: "custom",
        status: "pending",
      },
    });
  } catch (error) {
    if (isHostConflict(error)) throw hostTaken();
    throw error;
  }
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.domain.add",
    resourceType: "partner_domain",
    resourceId: actor.partnerId,
    result: "success",
    origin: "admin",
    metadata: { target: host, status: "pending" },
  });
  return { host };
}

/** A custom domain of the actor's partner, for verification or removal. */
export async function getPartnerCustomDomain(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  input: string,
): Promise<{ host: string; cloudflareHostnameId: string | null }> {
  requirePartnerManager(actor);
  const host = normalizeHost(input) ?? "";
  const row = await tx.partnerDomain.findUnique({ where: { host } });
  if (!row || row.partnerId !== actor.partnerId || row.kind !== "custom") {
    throw notFound();
  }
  return { host, cloudflareHostnameId: row.cloudflareHostnameId };
}

export async function recordPartnerDomainCheck(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  host: string,
  result: DomainCheckResult,
): Promise<void> {
  const current = await getPartnerCustomDomain(tx, actor, host);
  const row = await tx.partnerDomain.findUniqueOrThrow({
    where: { host: current.host },
  });
  // A disabled domain stays disabled; an active one is never downgraded by
  // a failed check (the legacy keeps it too).
  const status =
    row.status === "pending" ? result.status : (row.status as string);
  const now = new Date();
  await tx.partnerDomain.update({
    where: { host: current.host },
    data: {
      status,
      sslStatus: result.sslStatus,
      cloudflareHostnameId: result.cloudflareHostnameId,
      lastError: result.lastError,
      checkedAt: now,
      ...(status === "active" && row.status !== "active"
        ? { verifiedAt: now }
        : {}),
    },
  });
  if (status !== row.status) {
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: "partner.domain.status.update",
      resourceType: "partner_domain",
      resourceId: actor.partnerId,
      result: "success",
      origin: "admin",
      metadata: { target: current.host, from: row.status, to: status },
    });
  }
}

export async function removePartnerCustomDomain(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  input: string,
): Promise<{ host: string; cloudflareHostnameId: string | null }> {
  const domain = await getPartnerCustomDomain(tx, actor, input);
  await tx.partnerDomain.delete({ where: { host: domain.host } });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.domain.remove",
    resourceType: "partner_domain",
    resourceId: actor.partnerId,
    result: "success",
    origin: "admin",
    metadata: { target: domain.host },
  });
  return domain;
}

// ----------------------------------------------------------------------------
// Workspace public domains
// ----------------------------------------------------------------------------

export async function canManageWorkspaceDomains(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
): Promise<boolean> {
  if (actor.kind === "partner") {
    return Boolean(
      actor.partnerRole &&
      isPartnerRole(actor.partnerRole) &&
      hasPartnerRolePermission(
        actor.partnerRole,
        Permissions.PARTNER_CUSTOMERS_MANAGE,
      ),
    );
  }
  const role = await getEffectiveWorkspaceRole(tx, actor.ctx);
  return role ? workspaceRoleGrants(role, "workspace.settings.update") : false;
}

async function requireWorkspaceManager(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
  target: WorkspaceRef,
): Promise<void> {
  if (
    actor.kind === "workspace" &&
    (actor.ctx.workspaceId !== target.workspaceId ||
      actor.ctx.organizationId !== target.organizationId)
  ) {
    throw new PermissionDeniedError();
  }
  if (!(await canManageWorkspaceDomains(tx, actor))) {
    throw new PermissionDeniedError();
  }
}

function auditCtx(actor: WorkspaceDomainActor): RequestContext {
  return actor.kind === "workspace"
    ? actor.ctx
    : adminAuditContext(actor.userId);
}

export async function listWorkspaceDomains(
  tx: ContextTransaction,
  workspaceIds: readonly string[],
): Promise<Array<DomainView & { workspaceId: string }>> {
  if (workspaceIds.length === 0) return [];
  const rows = await tx.workspaceDomain.findMany({
    where: { workspaceId: { in: [...workspaceIds] } },
    orderBy: [{ isPrimary: "desc" }, { host: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    host: row.host,
    kind: "custom",
    status: row.status,
    sslStatus: row.sslStatus,
    isPrimary: row.isPrimary,
    lastError: row.lastError,
    checkedAt: row.checkedAt,
  }));
}

/** Limit of public domains of a workspace and how many it has. */
export async function workspaceDomainQuota(
  tx: ContextTransaction,
  target: WorkspaceRef,
): Promise<{ limit: number | null; used: number }> {
  const [quota, used] = await Promise.all([
    resolveQuota(
      tx,
      target.organizationId,
      PUBLIC_DOMAINS_QUOTA,
      PUBLIC_DOMAINS_DEFAULT_LIMIT,
    ),
    tx.workspaceDomain.count({ where: { workspaceId: target.workspaceId } }),
  ]);
  return { limit: quota.limit, used };
}

export async function addWorkspaceDomain(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
  target: WorkspaceRef,
  input: string,
): Promise<{ id: string; host: string }> {
  await requireWorkspaceManager(tx, actor, target);
  const host = parseCustomHost(input);

  // Serializes additions per workspace so the quota holds.
  await tx.$executeRaw`
    select pg_advisory_xact_lock(hashtext('workspace_domains:' || ${target.workspaceId}::text))
  `;
  const quota = await resolveQuota(
    tx,
    target.organizationId,
    PUBLIC_DOMAINS_QUOTA,
    PUBLIC_DOMAINS_DEFAULT_LIMIT,
  );
  const used = await tx.workspaceDomain.count({
    where: { workspaceId: target.workspaceId },
  });
  assertWithinQuota(quota, used, "Domínios públicos");
  await assertHostFree(tx, host);

  let created: { id: string };
  try {
    created = await tx.workspaceDomain.create({
      data: {
        host,
        workspaceId: target.workspaceId,
        organizationId: target.organizationId,
        status: "pending",
        createdBy: actor.userId,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isHostConflict(error)) throw hostTaken();
    throw error;
  }
  await recordAudit(tx, auditCtx(actor), {
    action: "workspace.domain.add",
    resourceType: "workspace_domain",
    resourceId: target.workspaceId,
    result: "success",
    origin: actor.kind === "workspace" ? "app" : "admin",
    metadata: { target: host, status: "pending" },
  });
  return { id: created.id, host };
}

/** A public domain the actor manages, for verification, primary or removal. */
export async function getWorkspaceDomain(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
  id: string,
) {
  const row = /^[0-9a-f-]{36}$/i.test(id)
    ? await tx.workspaceDomain.findUnique({ where: { id } })
    : null;
  if (!row) throw notFound();
  await requireWorkspaceManager(tx, actor, row);
  return row;
}

export async function recordWorkspaceDomainCheck(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
  id: string,
  result: DomainCheckResult,
): Promise<void> {
  const row = await getWorkspaceDomain(tx, actor, id);
  const status = row.status === "pending" ? result.status : row.status;
  const now = new Date();
  // The first active domain of the workspace becomes its primary one.
  const makePrimary =
    status === "active" &&
    row.status !== "active" &&
    (await tx.workspaceDomain.count({
      where: { workspaceId: row.workspaceId, isPrimary: true },
    })) === 0;
  await tx.workspaceDomain.update({
    where: { id: row.id },
    data: {
      status,
      sslStatus: result.sslStatus,
      cloudflareHostnameId: result.cloudflareHostnameId,
      lastError: result.lastError,
      checkedAt: now,
      ...(status === "active" && row.status !== "active"
        ? { verifiedAt: now }
        : {}),
      ...(makePrimary ? { isPrimary: true } : {}),
    },
  });
  if (status !== row.status) {
    await recordAudit(tx, auditCtx(actor), {
      action: "workspace.domain.status.update",
      resourceType: "workspace_domain",
      resourceId: row.workspaceId,
      result: "success",
      origin: actor.kind === "workspace" ? "app" : "admin",
      metadata: { target: row.host, from: row.status, to: status },
    });
  }
}

export async function setPrimaryWorkspaceDomain(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
  id: string,
): Promise<void> {
  const row = await getWorkspaceDomain(tx, actor, id);
  if (row.status !== "active") {
    throw invalid(
      "Só um domínio ativo pode ser o principal.",
      "primaryNotActive",
    );
  }
  if (row.isPrimary) return;
  await tx.workspaceDomain.updateMany({
    where: { workspaceId: row.workspaceId, isPrimary: true },
    data: { isPrimary: false },
  });
  await tx.workspaceDomain.update({
    where: { id: row.id },
    data: { isPrimary: true },
  });
  await recordAudit(tx, auditCtx(actor), {
    action: "workspace.domain.primary",
    resourceType: "workspace_domain",
    resourceId: row.workspaceId,
    result: "success",
    origin: actor.kind === "workspace" ? "app" : "admin",
    metadata: { target: row.host },
  });
}

export async function removeWorkspaceDomain(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
  id: string,
): Promise<{ host: string; cloudflareHostnameId: string | null }> {
  const row = await getWorkspaceDomain(tx, actor, id);
  await tx.workspaceDomain.delete({ where: { id: row.id } });
  await recordAudit(tx, auditCtx(actor), {
    action: "workspace.domain.remove",
    resourceType: "workspace_domain",
    resourceId: row.workspaceId,
    result: "success",
    origin: actor.kind === "workspace" ? "app" : "admin",
    metadata: { target: row.host },
  });
  return { host: row.host, cloudflareHostnameId: row.cloudflareHostnameId };
}

/** Workspaces of the partner's companies, for the /admin domain screen. */
export async function listPartnerCustomerWorkspaces(
  tx: ContextTransaction,
): Promise<
  Array<{
    workspaceId: string;
    organizationId: string;
    organizationName: string;
    workspaceName: string;
    workspaceSlug: string;
  }>
> {
  const rows = await tx.$queryRaw<
    Array<{
      workspace_id: string;
      organization_id: string;
      organization_name: string;
      workspace_name: string;
      workspace_slug: string;
    }>
  >`select * from private.partner_customer_workspaces()`;
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
  }));
}
