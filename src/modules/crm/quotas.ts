import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

/** Usage of the CRM quotas (F4c), shown on "Consumo & Limites". */
export const crmQuotaUsage = {
  "crm.contacts": {
    moduleKey: "crm",
    scope: "workspace" as const,
    count: (tx: ContextTransaction, ctx: RequestContext) =>
      tx.crmContact.count({ where: { workspaceId: ctx.workspaceId } }),
  },
};
