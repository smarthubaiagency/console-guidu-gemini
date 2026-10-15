import type { ModuleDataContract } from "@/core/privacy/contract";

/**
 * Export and purge of the AI agents' data (F3e): the GUIDS (A1) with their
 * referrals and scoring log, and their conversations, messages and usage
 * (A2a). Credentials live in the vaults and are never exported; the
 * configuration only names the credential it uses. The Assistant's
 * conversations belong to the person who had them, not to the workspace:
 * they leave with the workspace's purge but are not in its export.
 */
export const aiAgentsDataContract: ModuleDataContract = {
  moduleKey: "ai-agents",
  async export(tx, ctx) {
    const where = { workspaceId: ctx.workspaceId };
    const [guids, referrals, leadActivities, conversations, usage] =
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
        tx.aiConversation.findMany({
          where: { ...where, kind: "guid" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            agentId: true,
            contactId: true,
            channel: true,
            status: true,
            variables: true,
            summary: true,
            lastMessageAt: true,
            closedAt: true,
            createdAt: true,
          },
        }),
        // The workspace's own consumption and the backup courtesy.
        tx.aiUsageEvent.findMany({
          where: { ...where, keySource: { in: ["customer", "backup"] } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            executionId: true,
            agentId: true,
            conversationId: true,
            keySource: true,
            provider: true,
            model: true,
            usageKind: true,
            inputTokens: true,
            outputTokens: true,
            errorCode: true,
            createdAt: true,
          },
        }),
      ]);
    const messages = await tx.aiMessage.findMany({
      where: { conversationId: { in: conversations.map((c) => c.id) } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        toolCalls: true,
        toolCallId: true,
        toolName: true,
        model: true,
        createdAt: true,
      },
    });
    const leadNotices = await tx.aiLeadNotice.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        agentId: true,
        kind: true,
        contactId: true,
        conversationId: true,
        referralId: true,
        reasonText: true,
        points: true,
        temperature: true,
        channel: true,
        status: true,
        reason: true,
        createdAt: true,
        sentAt: true,
      },
    });
    return {
      guids,
      referrals,
      leadActivities,
      leadNotices,
      conversations,
      messages,
      usage,
    };
  },
  async purge(tx, workspaceId) {
    const where = { workspaceId };
    // Usage and the scoring log reference agents, conversations, referrals
    // and contacts: they go first. Messages leave with their conversations.
    const usage = await tx.aiUsageEvent.deleteMany({ where });
    const leadActivities = await tx.aiLeadActivity.deleteMany({ where });
    const leadNotices = await tx.aiLeadNotice.deleteMany({ where });
    const conversations = await tx.aiConversation.deleteMany({ where });
    const referrals = await tx.aiAgentReferral.deleteMany({ where });
    const guids = await tx.aiAgent.deleteMany({ where });
    return {
      ai_usage_events: usage.count,
      ai_lead_activities: leadActivities.count,
      ai_lead_notices: leadNotices.count,
      ai_conversations: conversations.count,
      ai_agent_referrals: referrals.count,
      ai_agents: guids.count,
    };
  },
};
