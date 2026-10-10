import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { recordAudit } from "@/core/audit/record";
import { startSubscription } from "@/core/billing/partner";
import { adminAuditContext } from "@/core/module-runtime/settings";
import { generateInvitationToken } from "@/core/organizations/invitations";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  hasPartnerRolePermission,
  type PartnerRoleKey,
} from "@/core/permissions/matrix";
import { Permissions } from "@/core/permissions/catalog";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { listRegisteredModules } from "@/modules/registry";
import { AppError } from "@/shared/errors";

import { invalidPartnerInput, partnerNotFound } from "./errors";

/**
 * Customers registered by the partner, workspace templates and the partner's
 * module catalog (ADR 0012, P4b). Runs in withIdentityContext with the
 * partner of the request host; RLS repeats every check. The partner writes
 * the new organization, workspace, modules and invitation, but gains no read
 * access to the workspace or its data.
 */

export type PartnerManager = Readonly<{
  userId: string;
  partnerRole: PartnerRoleKey | null;
}>;

export const CUSTOMER_INVITATION_TTL_HOURS = 168;

function requireCustomerManager(actor: PartnerManager): void {
  if (
    !actor.partnerRole ||
    !hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_CUSTOMERS_MANAGE,
    )
  ) {
    throw new PermissionDeniedError();
  }
}

export type OfferableModule = Readonly<{
  moduleKey: string;
  displayName: string;
  releaseStatus: string;
}>;

/** Modules the platform ships and a partner may offer (not "coming soon"). */
export function listOfferableModules(): OfferableModule[] {
  return listRegisteredModules()
    .filter((mod) => mod.technicalGate())
    .filter((mod) => mod.manifest.releaseStatus !== "coming_soon")
    .map((mod) => ({
      moduleKey: mod.manifest.moduleKey,
      displayName: mod.manifest.displayName,
      releaseStatus: mod.manifest.releaseStatus,
    }));
}

export async function listOfferedModuleKeys(
  tx: ContextTransaction,
  partnerId: string,
): Promise<string[]> {
  const rows = await tx.partnerOfferedModule.findMany({
    where: { partnerId },
    select: { moduleKey: true },
  });
  const offerable = new Set(listOfferableModules().map((m) => m.moduleKey));
  return rows.map((r) => r.moduleKey).filter((key) => offerable.has(key));
}

export async function setModuleOffered(
  tx: ContextTransaction,
  actor: PartnerManager,
  partnerId: string,
  moduleKey: string,
  offered: boolean,
): Promise<void> {
  requireCustomerManager(actor);
  if (!listOfferableModules().some((m) => m.moduleKey === moduleKey)) {
    throw invalidPartnerInput("Módulo indisponível para oferta.");
  }

  const current = await tx.partnerOfferedModule.findUnique({
    where: { partnerId_moduleKey: { partnerId, moduleKey } },
  });
  if (Boolean(current) === offered) return;

  if (offered) {
    await tx.partnerOfferedModule.create({
      data: { partnerId, moduleKey, createdBy: actor.userId },
    });
  } else {
    await tx.partnerOfferedModule.delete({
      where: { partnerId_moduleKey: { partnerId, moduleKey } },
    });
  }
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: offered ? "partner.module.offer" : "partner.module.withdraw",
    resourceType: "partner_offered_module",
    resourceId: partnerId,
    result: "success",
    origin: "app",
    metadata: { target: moduleKey },
  });
}

const TemplateInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do modelo.").max(80),
  moduleKeys: z.array(z.string()).max(32),
});

export async function listWorkspaceTemplates(
  tx: ContextTransaction,
  partnerId: string,
) {
  return tx.partnerWorkspaceTemplate.findMany({
    where: { partnerId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, moduleKeys: true },
  });
}

/** A template may only use modules the partner currently offers. */
export async function createWorkspaceTemplate(
  tx: ContextTransaction,
  actor: PartnerManager,
  partnerId: string,
  input: Readonly<{ name: string; moduleKeys: readonly string[] }>,
): Promise<{ id: string }> {
  requireCustomerManager(actor);
  const parsed = TemplateInputSchema.safeParse({
    name: input.name,
    moduleKeys: [...new Set(input.moduleKeys)],
  });
  if (!parsed.success) {
    throw invalidPartnerInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const offered = new Set(await listOfferedModuleKeys(tx, partnerId));
  if (parsed.data.moduleKeys.some((key) => !offered.has(key))) {
    throw invalidPartnerInput(
      "O modelo só pode usar módulos oferecidos pelo parceiro.",
    );
  }
  const existing = await tx.partnerWorkspaceTemplate.findUnique({
    where: { partnerId_name: { partnerId, name: parsed.data.name } },
    select: { id: true },
  });
  if (existing) {
    throw new AppError({
      code: "conflict",
      safeMessage: "Já existe um modelo com esse nome.",
    });
  }

  const template = await tx.partnerWorkspaceTemplate.create({
    data: {
      partnerId,
      name: parsed.data.name,
      moduleKeys: parsed.data.moduleKeys,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.template.create",
    resourceType: "partner_workspace_template",
    resourceId: template.id,
    result: "success",
    origin: "app",
    metadata: { name: parsed.data.name, target: partnerId },
  });
  return template;
}

export async function deleteWorkspaceTemplate(
  tx: ContextTransaction,
  actor: PartnerManager,
  partnerId: string,
  templateId: string,
): Promise<void> {
  requireCustomerManager(actor);
  const deleted = await tx.partnerWorkspaceTemplate.deleteMany({
    where: { id: templateId, partnerId },
  });
  if (deleted.count === 0) throw partnerNotFound();
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.template.delete",
    resourceType: "partner_workspace_template",
    resourceId: templateId,
    result: "success",
    origin: "app",
    metadata: { target: partnerId },
  });
}

const WORKSPACE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

const CustomerInputSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(1, "Informe o nome da empresa.")
    .max(120),
  workspaceName: z
    .string()
    .trim()
    .min(1, "Informe o nome do workspace.")
    .max(80),
  workspaceSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      WORKSPACE_SLUG,
      "Endereço do workspace: 3 a 48 letras minúsculas, números ou hífen.",
    ),
  ownerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Informe um e-mail válido.")
    .max(254),
  templateId: z.string().uuid().nullable(),
  planId: z.string().uuid().nullable(),
});

export type CustomerInput = Readonly<{
  organizationName: string;
  workspaceName: string;
  workspaceSlug: string;
  ownerEmail: string;
  templateId?: string | null;
  /** Base plan of the pending subscription; default: the first active one. */
  planId?: string | null;
}>;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" ||
      (error.code === "P2010" &&
        (error.meta as { code?: string } | undefined)?.code === "23505"))
  );
}

/**
 * Registers a customer of the context partner: company, first workspace,
 * modules of the chosen template and the owner invitation. The workspace
 * owner accepts the link with the invited e-mail, on the partner domain.
 * Raw inserts avoid RETURNING: the partner has no read access to the rows.
 */
export async function createPartnerCustomer(
  tx: ContextTransaction,
  actor: PartnerManager,
  partnerId: string,
  input: CustomerInput,
  origin: string,
): Promise<{
  organizationId: string;
  workspaceId: string;
  workspaceSlug: string;
  inviteUrl: string;
}> {
  requireCustomerManager(actor);
  const parsed = CustomerInputSchema.safeParse({
    ...input,
    templateId: input.templateId || null,
    planId: input.planId || null,
  });
  if (!parsed.success) {
    throw invalidPartnerInput(
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  const data = parsed.data;

  let moduleKeys: string[] = [];
  if (data.templateId) {
    const template = await tx.partnerWorkspaceTemplate.findFirst({
      where: { id: data.templateId, partnerId },
      select: { moduleKeys: true },
    });
    if (!template) throw invalidPartnerInput("Modelo não encontrado.");
    // A module withdrawn after the template was saved is not enabled.
    const offered = new Set(await listOfferedModuleKeys(tx, partnerId));
    moduleKeys = template.moduleKeys.filter((key) => offered.has(key));
  }

  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const { rawToken, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(
    Date.now() + CUSTOMER_INVITATION_TTL_HOURS * 3600 * 1000,
  );

  await tx.$executeRaw`
    insert into public.organizations (id, name, status, partner_id)
    values (${organizationId}::uuid, ${data.organizationName}, 'active', ${partnerId}::uuid)
  `;
  try {
    await tx.$executeRaw`
      insert into public.workspaces (id, organization_id, slug, name, status)
      values (${workspaceId}::uuid, ${organizationId}::uuid, ${data.workspaceSlug}, ${data.workspaceName}, 'active')
    `;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        code: "conflict",
        safeMessage: "Esse endereço de workspace já está em uso.",
      });
    }
    throw error;
  }
  for (const moduleKey of moduleKeys) {
    await tx.$executeRaw`
      insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
      values (${organizationId}::uuid, ${workspaceId}::uuid, ${moduleKey}, 'enabled', ${actor.userId}::uuid)
    `;
  }
  await tx.$executeRaw`
    insert into public.invitations
      (organization_id, workspace_id, email, role, token_hash, invited_by_user_id, status, expires_at)
    values
      (${organizationId}::uuid, ${workspaceId}::uuid, ${data.ownerEmail}, 'owner',
       ${tokenHash}, ${actor.userId}::uuid, 'pending', ${expiresAt})
  `;

  // Born pending: active only after the first recorded payment (criterion
  // 10, P5m). Without any plan in the catalog the customer has no plan.
  const planId =
    data.planId ??
    (
      await tx.plan.findFirst({
        where: { status: "active", versions: { some: {} } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
    )?.id;
  if (planId) {
    await startSubscription(
      tx,
      {
        userId: actor.userId,
        partnerRole: actor.partnerRole,
        canRegisterCustomers: true,
      },
      partnerId,
      { organizationId, planId },
    );
  }

  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "partner.customer.create",
    resourceType: "organization",
    resourceId: organizationId,
    result: "success",
    origin: "app",
    metadata: {
      name: data.organizationName,
      targetSlug: data.workspaceSlug,
      emailDomain: data.ownerEmail.split("@")[1] ?? "unknown",
      target: partnerId,
    },
  });

  return {
    organizationId,
    workspaceId,
    workspaceSlug: data.workspaceSlug,
    inviteUrl: `${origin}/invite/${rawToken}`,
  };
}
