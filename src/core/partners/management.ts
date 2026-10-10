import { randomUUID } from "node:crypto";

import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import {
  adminAuditContext,
  requirePlatformPermission,
} from "@/core/module-runtime/settings";
import { Permissions } from "@/core/permissions/catalog";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { invalidPartnerInput, partnerNotFound } from "./errors";
import { normalizeHost, platformHosts } from "./hosts";

/**
 * Partner management in the platform console (ADR 0012, P4a). Runs inside
 * withIdentityContext of an active platform admin; RLS repeats every check.
 * The house partner is never created, renamed or suspended here.
 */

export type PlatformActor = Readonly<{
  userId: string;
  role: PlatformAdminRoleKey | null;
}>;

export type PartnerSummary = Readonly<{
  id: string;
  slug: string;
  name: string;
  status: string;
  isHouse: boolean;
  domains: ReadonlyArray<{ host: string; kind: string; status: string }>;
  activeMembers: number;
}>;

const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const PartnerInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(48)
    .regex(SLUG, "Use letras minúsculas, números e hífen."),
});

export async function listPartners(
  tx: ContextTransaction,
  actor: PlatformActor,
): Promise<PartnerSummary[]> {
  requirePlatformPermission(actor.role, Permissions.PLATFORM_PARTNERS_READ);
  const partners = await tx.partner.findMany({
    orderBy: [{ isHouse: "desc" }, { name: "asc" }],
    include: {
      domains: { orderBy: { host: "asc" } },
      _count: {
        select: { members: { where: { status: "active" } } },
      },
    },
  });
  return partners.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    isHouse: p.isHouse,
    domains: p.domains.map((d) => ({
      host: d.host,
      kind: d.kind,
      status: d.status,
    })),
    activeMembers: p._count.members,
  }));
}

export async function createPartner(
  tx: ContextTransaction,
  actor: PlatformActor,
  input: z.input<typeof PartnerInputSchema>,
): Promise<{ id: string }> {
  requirePlatformPermission(actor.role, Permissions.PLATFORM_PARTNERS_MANAGE);
  const parsed = PartnerInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidPartnerInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }

  const existing = await tx.partner.findUnique({
    where: { slug: parsed.data.slug },
    select: { id: true },
  });
  if (existing) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Já existe um parceiro com esse identificador.",
    });
  }

  const id = randomUUID();
  await tx.partner.create({
    data: { id, slug: parsed.data.slug, name: parsed.data.name },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.create",
    resourceType: "partner",
    resourceId: id,
    result: "success",
    origin: "admin",
    metadata: { targetSlug: parsed.data.slug, name: parsed.data.name },
  });
  return { id };
}

async function requireManagedPartner(tx: ContextTransaction, id: string) {
  const partner = await tx.partner.findUnique({ where: { id } });
  if (!partner) throw partnerNotFound();
  if (partner.isHouse) {
    throw new AppError({
      code: "conflict",
      safeMessage: "O parceiro da casa não pode ser alterado aqui.",
    });
  }
  return partner;
}

export async function setPartnerStatus(
  tx: ContextTransaction,
  actor: PlatformActor,
  partnerId: string,
  status: "active" | "suspended",
): Promise<void> {
  requirePlatformPermission(actor.role, Permissions.PLATFORM_PARTNERS_MANAGE);
  const partner = await requireManagedPartner(tx, partnerId);
  if (partner.status === status) return;

  await tx.partner.update({ where: { id: partnerId }, data: { status } });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.status.update",
    resourceType: "partner",
    resourceId: partnerId,
    result: "success",
    origin: "admin",
    metadata: { from: partner.status, to: status },
  });
}

export async function addPartnerDomain(
  tx: ContextTransaction,
  actor: PlatformActor,
  partnerId: string,
  input: Readonly<{ host: string; kind: "subdomain" | "custom" }>,
): Promise<{ host: string }> {
  requirePlatformPermission(actor.role, Permissions.PLATFORM_PARTNERS_MANAGE);
  await requireManagedPartner(tx, partnerId);

  const host = normalizeHost(input.host);
  if (!host || !host.includes(".")) {
    throw invalidPartnerInput(
      "Informe um domínio válido, como app.agencia.com.br.",
    );
  }
  if (platformHosts(process.env).has(host)) {
    throw invalidPartnerInput("Esse domínio pertence à plataforma.");
  }
  const taken = await tx.partnerDomain.findUnique({ where: { host } });
  if (taken) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Esse domínio já está cadastrado.",
    });
  }

  await tx.partnerDomain.create({
    data: { host, partnerId, kind: input.kind, status: "pending" },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.domain.add",
    resourceType: "partner_domain",
    resourceId: partnerId,
    result: "success",
    origin: "admin",
    metadata: { target: host, status: "pending" },
  });
  return { host };
}

/**
 * Activates or disables a domain. Until P7 there is no DNS verification:
 * activation is a manual platform decision, recorded in the audit log.
 */
export async function setPartnerDomainStatus(
  tx: ContextTransaction,
  actor: PlatformActor,
  host: string,
  status: "active" | "disabled",
): Promise<void> {
  requirePlatformPermission(actor.role, Permissions.PLATFORM_PARTNERS_MANAGE);
  const normalized = normalizeHost(host) ?? "";
  const domain = await tx.partnerDomain.findUnique({
    where: { host: normalized },
  });
  if (!domain) throw partnerNotFound();
  await requireManagedPartner(tx, domain.partnerId);
  if (domain.status === status) return;

  await tx.partnerDomain.update({
    where: { host: normalized },
    data: { status },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.domain.status.update",
    resourceType: "partner_domain",
    resourceId: domain.partnerId,
    result: "success",
    origin: "admin",
    metadata: { target: normalized, from: domain.status, to: status },
  });
}
