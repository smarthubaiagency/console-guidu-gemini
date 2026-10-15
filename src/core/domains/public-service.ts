import { recordAudit } from "@/core/audit/record";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { HOUSE_PARTNER_ID } from "@/core/partners/constants";
import { PermissionDeniedError } from "@/core/permissions/guard";
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
import {
  effectivePublicBases,
  isPublicRouteType,
  isUnder,
  platformPublicBases,
  PUBLIC_ROUTE_TYPES,
  type PublicRouteType,
  workspaceDefaultHost,
} from "./public-hosts";
import {
  canManagePartnerDomains,
  canManageWorkspaceDomains,
  type PartnerDomainActor,
  type WorkspaceDomainActor,
  type WorkspaceRef,
} from "./service";
import type { BaseDomainCheckResult } from "./verify";

/**
 * Default public domains (CF2c): the partner's own default domain per route
 * type, the default addresses of a workspace and the domain each tool with
 * a public route uses. Every function runs in the actor's transaction; RLS
 * repeats the checks. DNS checks happen outside, in the actions.
 */

export type PartnerPublicDomainView = Readonly<{
  id: string;
  routeType: PublicRouteType;
  host: string;
  status: string;
  lastError: string | null;
  checkedAt: Date | null;
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

function hostTaken(): AppError {
  return new AppError({
    code: "conflict",
    safeMessage: "Esse domínio já está cadastrado.",
    messageKey: "domains.errors.taken",
  });
}

function isHostConflict(error: unknown): boolean {
  const text = error instanceof Error ? error.message : "";
  return (
    (error as { code?: string } | null)?.code === "P2002" ||
    /unique|domain host already in use/i.test(text)
  );
}

function routeType(value: unknown): PublicRouteType {
  if (!isPublicRouteType(value)) {
    throw invalid("Tipo de rota pública inválido.", "invalidRouteType");
  }
  return value;
}

const TOOL_KEY = /^[a-z][a-z0-9-]{1,62}$/;

function toolKey(value: unknown): string {
  if (typeof value !== "string" || !TOOL_KEY.test(value)) {
    throw invalid("Ferramenta inválida.", "invalidTool");
  }
  return value;
}

/**
 * Host typed for a partner's default domain. Besides the rules of a custom
 * domain, it may not hold a platform host or a platform default domain
 * under it, since every name under it becomes a workspace address.
 */
export function parseBaseHost(input: string): string {
  const raw = input
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^\*\./, "")
    .split(/[/?#]/)[0];
  const host = normalizeHost(raw);
  if (!host || !host.includes(".") || host.length > 200) {
    throw invalid(
      "Informe um domínio válido, como cartao.suaempresa.com.br.",
      "invalidBaseDomain",
    );
  }
  const reserved = [
    ...platformHosts(process.env),
    ...Object.values(platformPublicBases()).filter(
      (value): value is string => value !== null,
    ),
    partnerSubdomainBase(process.env),
    domainsConfig().cnameTarget,
  ].filter((value): value is string => Boolean(value));
  if (reserved.some((r) => isUnder(host, r) || isUnder(r, host))) {
    throw invalid("Esse domínio pertence à plataforma.", "platformDomain");
  }
  return host;
}

// ----------------------------------------------------------------------------
// Partner default domains
// ----------------------------------------------------------------------------

function requirePartnerManager(actor: PartnerDomainActor): void {
  if (!canManagePartnerDomains(actor)) throw new PermissionDeniedError();
}

export async function listPartnerPublicDomains(
  tx: ContextTransaction,
  partnerId: string,
): Promise<PartnerPublicDomainView[]> {
  const rows = await tx.partnerPublicDomain.findMany({
    where: { partnerId },
    orderBy: { routeType: "asc" },
  });
  return rows
    .filter((row) => isPublicRouteType(row.routeType))
    .map((row) => ({
      id: row.id,
      routeType: row.routeType as PublicRouteType,
      host: row.host,
      status: row.status,
      lastError: row.lastError,
      checkedAt: row.checkedAt,
    }));
}

export async function addPartnerPublicDomain(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  input: Readonly<{ routeType: unknown; host: string }>,
): Promise<{ id: string; host: string; routeType: PublicRouteType }> {
  requirePartnerManager(actor);
  if (actor.partnerId === HOUSE_PARTNER_ID) {
    throw invalid(
      "O domínio padrão da plataforma é definido pela operação.",
      "housePartner",
    );
  }
  const type = routeType(input.routeType);
  const host = parseBaseHost(input.host);
  const existing = await tx.partnerPublicDomain.findUnique({
    where: {
      partnerId_routeType: { partnerId: actor.partnerId, routeType: type },
    },
    select: { id: true },
  });
  if (existing) {
    throw new AppError({
      code: "conflict",
      safeMessage:
        "Já existe um domínio padrão para esse tipo. Remova-o antes.",
      messageKey: "domains.errors.baseExists",
    });
  }
  let created: { id: string };
  try {
    created = await tx.partnerPublicDomain.create({
      data: {
        partnerId: actor.partnerId,
        routeType: type,
        host,
        status: "pending",
        createdBy: actor.userId,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isHostConflict(error)) throw hostTaken();
    throw error;
  }
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.public_domain.add",
    resourceType: "partner_public_domain",
    resourceId: actor.partnerId,
    result: "success",
    origin: "admin",
    metadata: { target: host, kind: type, status: "pending" },
  });
  return { id: created.id, host, routeType: type };
}

export async function getPartnerPublicDomain(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  id: string,
) {
  requirePartnerManager(actor);
  const row = /^[0-9a-f-]{36}$/i.test(id)
    ? await tx.partnerPublicDomain.findUnique({ where: { id } })
    : null;
  if (!row || row.partnerId !== actor.partnerId) throw notFound();
  return row;
}

export async function recordPartnerPublicDomainCheck(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  id: string,
  result: BaseDomainCheckResult,
): Promise<void> {
  const row = await getPartnerPublicDomain(tx, actor, id);
  // As with custom domains: a failed check never takes an active one down.
  const status = row.status === "pending" ? result.status : row.status;
  const now = new Date();
  await tx.partnerPublicDomain.update({
    where: { id: row.id },
    data: {
      status,
      lastError: result.lastError,
      checkedAt: now,
      ...(status === "active" && row.status !== "active"
        ? { verifiedAt: now }
        : {}),
    },
  });
  if (status !== row.status) {
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: "partner.public_domain.status.update",
      resourceType: "partner_public_domain",
      resourceId: actor.partnerId,
      result: "success",
      origin: "admin",
      metadata: { target: row.host, from: row.status, to: status },
    });
  }
}

export async function removePartnerPublicDomain(
  tx: ContextTransaction,
  actor: PartnerDomainActor,
  id: string,
): Promise<{ host: string }> {
  const row = await getPartnerPublicDomain(tx, actor, id);
  await tx.partnerPublicDomain.delete({ where: { id: row.id } });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.public_domain.remove",
    resourceType: "partner_public_domain",
    resourceId: actor.partnerId,
    result: "success",
    origin: "admin",
    metadata: { target: row.host, kind: row.routeType },
  });
  return { host: row.host };
}

// ----------------------------------------------------------------------------
// Default addresses of a workspace
// ----------------------------------------------------------------------------

export type PublicAddress = Readonly<{
  routeType: PublicRouteType;
  /** Default domain of the type for this workspace, or null when off. */
  base: string | null;
  source: "platform" | "partner";
  /** `{slug}.{base}`, or null when the slug cannot be used there. */
  host: string | null;
}>;

/** Default domain of each type for the context workspace, with its host. */
export async function workspacePublicAddresses(
  tx: ContextTransaction,
  workspaceSlug: string,
): Promise<PublicAddress[]> {
  const rows = await tx.$queryRaw<Array<{ route_type: string; host: string }>>`
    select route_type, host from private.context_public_bases()
  `;
  const platform = platformPublicBases();
  const bases = effectivePublicBases(
    platform,
    rows.map((row) => ({ routeType: row.route_type, host: row.host })),
  );
  const allBases = [
    ...Object.values(platform),
    ...rows.map((row) => row.host),
  ].filter((value): value is string => value !== null);
  return PUBLIC_ROUTE_TYPES.map((type) => ({
    routeType: type,
    base: bases[type].host,
    source: bases[type].source,
    host: workspaceDefaultHost(workspaceSlug, bases[type].host, allBases),
  }));
}

// ----------------------------------------------------------------------------
// Domain of each tool (selector)
// ----------------------------------------------------------------------------

export type PublicDomainChoice = Readonly<{
  toolKey: string;
  routeType: PublicRouteType;
  /** Default subdomain of the type; null when there is none. */
  defaultHost: string | null;
  /** Active own domains of the workspace the tool may use. */
  domains: ReadonlyArray<{ id: string; host: string; isPrimary: boolean }>;
  /** Chosen own domain, or null for the default. */
  domainId: string | null;
  /** Host the tool answers on: the chosen domain, else the default. */
  host: string | null;
}>;

/**
 * Everything the selector of a tool needs: the default host of its type,
 * the active own domains and the current choice. Used by the selector
 * component and, from DP1a on, by each tool to build its public links.
 */
export async function publicDomainChoice(
  tx: ContextTransaction,
  target: Readonly<{ workspaceId: string; workspaceSlug: string }>,
  input: Readonly<{ toolKey: unknown; routeType: unknown }>,
): Promise<PublicDomainChoice> {
  const key = toolKey(input.toolKey);
  const type = routeType(input.routeType);
  const [addresses, domains, chosen] = await Promise.all([
    workspacePublicAddresses(tx, target.workspaceSlug),
    tx.workspaceDomain.findMany({
      where: { workspaceId: target.workspaceId, status: "active" },
      orderBy: [{ isPrimary: "desc" }, { host: "asc" }],
      select: { id: true, host: true, isPrimary: true },
    }),
    tx.workspacePublicRoute.findUnique({
      where: {
        workspaceId_toolKey: { workspaceId: target.workspaceId, toolKey: key },
      },
      select: { domainId: true },
    }),
  ]);
  const defaultHost =
    addresses.find((address) => address.routeType === type)?.host ?? null;
  const domain = chosen
    ? domains.find((row) => row.id === chosen.domainId)
    : undefined;
  return {
    toolKey: key,
    routeType: type,
    defaultHost,
    domains,
    domainId: domain?.id ?? null,
    host: domain?.host ?? defaultHost,
  };
}

/**
 * Sets the domain of a tool: an active own domain of the workspace, or
 * null to go back to the default subdomain of its type.
 */
export async function choosePublicDomain(
  tx: ContextTransaction,
  actor: WorkspaceDomainActor,
  target: WorkspaceRef,
  input: Readonly<{
    toolKey: unknown;
    routeType: unknown;
    domainId: string | null;
  }>,
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
  const key = toolKey(input.toolKey);
  const type = routeType(input.routeType);
  const where = {
    workspaceId_toolKey: { workspaceId: target.workspaceId, toolKey: key },
  };
  const auditCtx: RequestContext =
    actor.kind === "workspace" ? actor.ctx : adminAuditContext(actor.userId);
  const origin = actor.kind === "workspace" ? "app" : "admin";

  if (input.domainId === null) {
    const removed = await tx.workspacePublicRoute.deleteMany({
      where: { workspaceId: target.workspaceId, toolKey: key },
    });
    if (removed.count > 0) {
      await recordAudit(tx, auditCtx, {
        action: "workspace.public_route.reset",
        resourceType: "workspace_public_route",
        resourceId: target.workspaceId,
        result: "success",
        origin,
        metadata: { tool: key, kind: type },
      });
    }
    return;
  }

  const domain = /^[0-9a-f-]{36}$/i.test(input.domainId)
    ? await tx.workspaceDomain.findUnique({ where: { id: input.domainId } })
    : null;
  if (!domain || domain.workspaceId !== target.workspaceId) throw notFound();
  if (domain.status !== "active") {
    throw invalid("Só um domínio ativo pode ser escolhido.", "choiceNotActive");
  }
  await tx.workspacePublicRoute.upsert({
    where,
    create: {
      workspaceId: target.workspaceId,
      organizationId: target.organizationId,
      toolKey: key,
      routeType: type,
      domainId: domain.id,
      updatedBy: actor.userId,
    },
    update: { routeType: type, domainId: domain.id, updatedBy: actor.userId },
  });
  await recordAudit(tx, auditCtx, {
    action: "workspace.public_route.update",
    resourceType: "workspace_public_route",
    resourceId: target.workspaceId,
    result: "success",
    origin,
    metadata: { tool: key, kind: type, target: domain.host },
  });
}
