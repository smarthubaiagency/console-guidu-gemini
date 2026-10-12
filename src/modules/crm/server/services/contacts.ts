import "server-only";

import { z } from "zod";

import { decodeCursor, pageOf } from "@/core/api/pagination";
import { recordAudit } from "@/core/audit/record";
import { assertWithinQuota, resolveQuota } from "@/core/entitlements/quotas";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import { CrmPermissions } from "../../manifest";

/**
 * Contacts of the CRM module (F4c). The same services serve the screens,
 * the REST API and the MCP: each one checks the module state (enabled,
 * contracted, suspended = read only) and the permission, and RLS repeats
 * tenant and role in the database.
 */

const MODULE_KEY = "crm";
const CONTACTS_QUOTA = "crm.contacts";

/** Empty strings from forms mean "no value". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length ? v : null))
    .nullable()
    .optional();

const fields = {
  name: z.string().trim().min(1, "Informe o nome.").max(160),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v.length ? v.toLowerCase() : null))
    .refine(
      (v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
      "E-mail inválido.",
    )
    .nullable()
    .optional(),
  phone: z
    .string()
    .trim()
    .max(40)
    .transform((v) => (v.length ? v : null))
    .refine((v) => v === null || v.length >= 3, "Telefone inválido.")
    .nullable()
    .optional(),
  companyName: optionalText(160),
  jobTitle: optionalText(120),
  notes: optionalText(5000),
};

export const ContactCreateInput = z.object(fields).strict();
export const ContactUpdateInput = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nada para alterar.");

export type ContactCreate = z.input<typeof ContactCreateInput>;
export type ContactUpdate = z.input<typeof ContactUpdateInput>;

export type ContactDto = Readonly<{
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}>;

type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: ContactRow): ContactDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    companyName: row.companyName,
    jobTitle: row.jobTitle,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Message keys of the schema's own messages; zod defaults keep their text. */
const ISSUE_KEYS: Readonly<Record<string, string>> = {
  "Informe o nome.": "crm.errors.nameRequired",
  "E-mail inválido.": "crm.errors.emailInvalid",
  "Telefone inválido.": "crm.errors.phoneInvalid",
  "Nada para alterar.": "crm.errors.nothingToChange",
};

function invalid(error: z.ZodError): AppError {
  const issue = error.issues[0];
  const messageKey = issue
    ? ISSUE_KEYS[issue.message]
    : "crm.errors.contactInvalid";
  return new AppError({
    code: "invalid_input",
    safeMessage: issue?.message ?? "Dados do contato inválidos.",
    ...(messageKey ? { messageKey } : {}),
  });
}

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Contato não encontrado.",
    messageKey: "crm.errors.contactNotFound",
  });
}

export const ListContactsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

/** Contacts, newest first; `search` matches name, e-mail or company. */
export async function listContacts(
  tx: ContextTransaction,
  ctx: RequestContext,
  query: z.input<typeof ListContactsQuery> = {},
): Promise<{
  items: ContactDto[];
  nextCursor: string | null;
  limit: number | null;
}> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, CrmPermissions.CONTACTS_READ);
  const q = ListContactsQuery.parse(query);
  const cursor = decodeCursor(q.cursor);
  const pattern = q.search
    ? `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    : null;
  const rows = await tx.$queryRaw<
    (ContactRow & { cursor_t: string; cursor_id: string })[]
  >`
    select id, name, email, phone, company_name as "companyName", job_title as "jobTitle",
           notes, created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt",
           created_at::text as cursor_t, id::text as cursor_id
    from public.crm_contacts
    where workspace_id = ${ctx.workspaceId}::uuid
      and (${pattern}::text is null
           or name ilike ${pattern} or email ilike ${pattern} or company_name ilike ${pattern})
      and (${cursor === null}::boolean
           or (created_at, id) < (${cursor?.t ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by created_at desc, id desc
    limit ${q.limit + 1}
  `;
  const { items, nextCursor } = pageOf(rows, q.limit);
  const quota = await resolveQuota(tx, ctx.organizationId, CONTACTS_QUOTA);
  return { items: items.map(toDto), nextCursor, limit: quota.limit };
}

export async function getContact(
  tx: ContextTransaction,
  ctx: RequestContext,
  contactId: string,
): Promise<ContactDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "read");
  await requireWorkspacePermission(tx, ctx, CrmPermissions.CONTACTS_READ);
  const id = z.string().uuid().safeParse(contactId);
  const row = id.success
    ? await tx.crmContact.findFirst({
        where: { id: id.data, workspaceId: ctx.workspaceId },
      })
    : null;
  if (!row) throw notFound();
  return toDto(row);
}

/** Creates a contact under the workspace quota (serialized per workspace). */
export async function createContact(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: unknown,
): Promise<ContactDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, CrmPermissions.CONTACTS_WRITE);
  const parsed = ContactCreateInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);

  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`crm_contacts:${ctx.workspaceId}`}))`;
  const [count, quota] = await Promise.all([
    tx.crmContact.count({ where: { workspaceId: ctx.workspaceId } }),
    resolveQuota(tx, ctx.organizationId, CONTACTS_QUOTA),
  ]);
  assertWithinQuota(quota, count, "contatos por workspace");

  const row = await tx.crmContact.create({
    data: {
      workspaceId: ctx.workspaceId,
      organizationId: ctx.organizationId,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      companyName: parsed.data.companyName ?? null,
      jobTitle: parsed.data.jobTitle ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: ctx.userId,
    },
  });
  await recordAudit(tx, ctx, {
    action: "crm.contact.create",
    resourceType: "crm_contact",
    resourceId: row.id,
    result: "success",
    origin: ctx.principalType === "api_key" ? "api" : "app",
  });
  return toDto(row);
}

/** Changes only the fields sent; absent fields stay as they are. */
export async function updateContact(
  tx: ContextTransaction,
  ctx: RequestContext,
  contactId: string,
  input: unknown,
): Promise<ContactDto> {
  await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  await requireWorkspacePermission(tx, ctx, CrmPermissions.CONTACTS_WRITE);
  const parsed = ContactUpdateInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const id = z.string().uuid().safeParse(contactId);
  if (!id.success) throw notFound();

  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  const changed = await tx.crmContact.updateMany({
    where: { id: id.data, workspaceId: ctx.workspaceId },
    data: { ...data, updatedBy: ctx.userId },
  });
  if (changed.count === 0) throw notFound();
  await recordAudit(tx, ctx, {
    action: "crm.contact.update",
    resourceType: "crm_contact",
    resourceId: id.data,
    result: "success",
    origin: ctx.principalType === "api_key" ? "api" : "app",
  });
  const row = await tx.crmContact.findFirstOrThrow({
    where: { id: id.data, workspaceId: ctx.workspaceId },
  });
  return toDto(row);
}
