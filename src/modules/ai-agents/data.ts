import type { ModuleDataContract } from "@/core/privacy/contract";

/**
 * Export and purge of the AI agents' data (F3e): the GUIDS (A1) with their
 * referrals and scoring log, and the rows of the prototype until A2 removes
 * it. Credentials live in the core vault and are never exported; the
 * configuration only names the credential it uses.
 */
export const aiAgentsDataContract: ModuleDataContract = {
  moduleKey: "ai-agents",
  async export(tx, ctx) {
    const where = { workspaceId: ctx.workspaceId };
    const [guids, referrals, leadActivities, agents, sessions, messages] =
      await Promise.all([
        tx.aiAgent.findMany({
          where: { ...where, kind: "guid" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            templateId: true,
            templateVersion: true,
            customized: true,
            config: true,
            configVersion: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        tx.aiAgentReferral.findMany({
          where,
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            referralTag: true,
            specialties: true,
            phone: true,
            city: true,
            remote: true,
            createdAt: true,
          },
        }),
        tx.aiLeadActivity.findMany({
          where,
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            contactId: true,
            agentId: true,
            referralId: true,
            points: true,
            temperature: true,
            scoreBreakdown: true,
            createdAt: true,
          },
        }),
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
    return { guids, referrals, leadActivities, agents, sessions, messages };
  },
  async purge(tx, workspaceId) {
    const where = { workspaceId };
    // The scoring log references agents and referrals: it goes first.
    const leadActivities = await tx.aiLeadActivity.deleteMany({ where });
    const referrals = await tx.aiAgentReferral.deleteMany({ where });
    const guids = await tx.aiAgent.deleteMany({ where });
    const messages = await tx.agentMessage.deleteMany({ where });
    const sessions = await tx.agentSession.deleteMany({ where });
    const agents = await tx.agentConfig.deleteMany({ where });
    return {
      ai_lead_activities: leadActivities.count,
      ai_agent_referrals: referrals.count,
      ai_agents: guids.count,
      agent_messages: messages.count,
      agent_sessions: sessions.count,
      agent_configs: agents.count,
    };
  },
};
