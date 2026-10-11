import type { ModuleDataContract } from "@/core/privacy/contract";

/** Export and purge of the CRM contacts (F3e contract, F4c). */
export const crmDataContract: ModuleDataContract = {
  moduleKey: "crm",
  async export(tx, ctx) {
    const contacts = await tx.crmContact.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        companyName: true,
        jobTitle: true,
        notes: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { contacts };
  },
  async purge(tx, workspaceId) {
    const contacts = await tx.crmContact.deleteMany({ where: { workspaceId } });
    return { crm_contacts: contacts.count };
  },
};
