import type { PrismaClient } from "@prisma/client";

import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import {
  createContact,
  getContact,
  listContacts,
  updateContact,
} from "@/modules/crm/server";

import type { ApiCall } from "./handler";

/**
 * REST routes of the CRM module (F4c): the module's own services, in the
 * caller's context, so module state, permission and quota apply as in the
 * screens (AC08).
 */

function ctxOf(call: ApiCall): RequestContext {
  if (!call.context) throw new Error("workspace route without context");
  return call.context;
}

export async function listCrmContacts(prisma: PrismaClient, call: ApiCall) {
  const ctx = ctxOf(call);
  const page = await withContext(prisma, ctx, (tx) =>
    listContacts(tx, ctx, call.query),
  );
  return { data: page.items, nextCursor: page.nextCursor };
}

export async function createCrmContact(prisma: PrismaClient, call: ApiCall) {
  const ctx = ctxOf(call);
  const contact = await withContext(prisma, ctx, (tx) =>
    createContact(tx, ctx, call.body),
  );
  return { data: contact };
}

export async function getCrmContact(prisma: PrismaClient, call: ApiCall) {
  const ctx = ctxOf(call);
  const contact = await withContext(prisma, ctx, (tx) =>
    getContact(tx, ctx, call.params.contactId ?? ""),
  );
  return { data: contact };
}

export async function updateCrmContact(prisma: PrismaClient, call: ApiCall) {
  const ctx = ctxOf(call);
  const contact = await withContext(prisma, ctx, (tx) =>
    updateContact(tx, ctx, call.params.contactId ?? "", call.body),
  );
  return { data: contact };
}
