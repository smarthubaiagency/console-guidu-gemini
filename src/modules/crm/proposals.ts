import "server-only";

import { z } from "zod";

import { requireWorkspacePermission } from "@/core/permissions/guard";
import type { ProposalOperation } from "@/core/proposals/operation";
import { AppError } from "@/shared/errors";

import { CrmPermissions } from "./manifest";
import {
  ContactCreateInput,
  ContactUpdateInput,
  createContact,
  getContact,
  invalid,
  updateContact,
} from "./server/services/contacts";

/**
 * Operations of the CRM that an assistant may propose through the MCP
 * (F4d, plano F4 decisão 3). The approved proposal runs the same services
 * as the screens and the REST API.
 */

const FIELDS = [
  { key: "name", label: "Nome" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Telefone" },
  { key: "companyName", label: "Empresa" },
  { key: "jobTitle", label: "Cargo" },
  { key: "notes", label: "Observações" },
] as const;

function parseWith(schema: z.ZodType, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  return Object.fromEntries(
    Object.entries(parsed.data as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    ),
  );
}

const notFound = () =>
  new AppError({
    code: "not_found",
    safeMessage: "Contato não encontrado.",
    messageKey: "crm.errors.contactNotFound",
  });

const contactVersion: ProposalOperation["version"] = async (
  tx,
  ctx,
  targetId,
) => {
  await requireWorkspacePermission(tx, ctx, CrmPermissions.CONTACTS_READ);
  if (!z.string().uuid().safeParse(targetId).success) throw notFound();
  // The text form keeps the microseconds a JavaScript Date would drop.
  const rows = await tx.$queryRaw<{ v: string }[]>`
    select updated_at::text as v from public.crm_contacts
    where id = ${targetId}::uuid and workspace_id = ${ctx.workspaceId}::uuid
  `;
  if (!rows[0]) throw notFound();
  return rows[0].v;
};

const contactValues: ProposalOperation["current"] = async (
  tx,
  ctx,
  targetId,
) => {
  const contact = await getContact(tx, ctx, targetId);
  return Object.fromEntries(FIELDS.map((f) => [f.key, contact[f.key]]));
};

export const crmProposalOperations: readonly ProposalOperation[] = [
  {
    key: "crm.contacts.create",
    moduleKey: "crm",
    label: "Adicionar contato",
    permission: CrmPermissions.CONTACTS_WRITE,
    needsTarget: false,
    fields: FIELDS,
    resourcePath: (id) => `crm/contacts/${id}`,
    parse: (input) => parseWith(ContactCreateInput, input),
    version: contactVersion,
    current: async () => ({}),
    async execute(tx, ctx, payload) {
      const contact = await createContact(tx, ctx, payload);
      return { resourceId: contact.id };
    },
  },
  {
    key: "crm.contacts.update",
    moduleKey: "crm",
    label: "Editar contato",
    permission: CrmPermissions.CONTACTS_WRITE,
    needsTarget: true,
    fields: FIELDS,
    resourcePath: (id) => `crm/contacts/${id}`,
    parse: (input) => parseWith(ContactUpdateInput, input),
    version: contactVersion,
    current: contactValues,
    async execute(tx, ctx, payload, targetId) {
      if (!targetId) throw notFound();
      const contact = await updateContact(tx, ctx, targetId, payload);
      return { resourceId: contact.id };
    },
  },
];
