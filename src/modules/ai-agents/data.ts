import type { ModuleDataContract } from "@/core/privacy/contract";

/**
 * Export and purge of the AI agents' data (F3e). The module stays frozen
 * (C04), but rows created before the freeze still belong to the workspace.
 * Credentials live in the core vault and are never exported.
 */
export const aiAgentsDataContract: ModuleDataContract = {
  moduleKey: "ai-agents",
  async export(tx, ctx) {
    const where = { workspaceId: ctx.workspaceId };
    const [agents, sessions, messages] = await Promise.all([
      tx.agentConfig.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          systemPrompt: true,
          primaryProvider: true,
          primaryModel: true,
          fallbackProvider: true,
          fallbackModel: true,
          status: true,
          createdAt: true,
        },
      }),
      tx.agentSession.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          agentConfigId: true,
          title: true,
          createdByUserId: true,
          status: true,
          createdAt: true,
        },
      }),
      tx.agentMessage.findMany({
        where,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sessionId: true,
          role: true,
          content: true,
          modelUsed: true,
          createdAt: true,
        },
      }),
    ]);
    return { agents, sessions, messages };
  },
  async purge(tx, workspaceId) {
    const where = { workspaceId };
    const messages = await tx.agentMessage.deleteMany({ where });
    const sessions = await tx.agentSession.deleteMany({ where });
    const agents = await tx.agentConfig.deleteMany({ where });
    return {
      agent_messages: messages.count,
      agent_sessions: sessions.count,
      agent_configs: agents.count,
    };
  },
};
