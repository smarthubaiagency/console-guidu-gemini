import type { ModuleDataContract } from "@/core/privacy/contract";

/** Export and purge of the reference module's records (F3e). */
export const helloWorldDataContract: ModuleDataContract = {
  moduleKey: "hello-world",
  async export(tx, ctx) {
    const records = await tx.helloWorldRecord.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, createdBy: true, createdAt: true },
    });
    return { records };
  },
  async purge(tx, workspaceId) {
    const records = await tx.helloWorldRecord.deleteMany({
      where: { workspaceId },
    });
    return { hello_world_records: records.count };
  },
};
