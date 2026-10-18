import "server-only";

import {
  defineSubscriber,
  withRequesterContext,
} from "@/core/events/subscriber";
import type { RequestContext } from "@/lib/prisma/with-context";

import { executeProposal } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Execution of an approved proposal through the hub (H4): the subscriber
 * of `proposals.approved`. It runs in the context of who approved (the
 * author of the event: a member in `padrao`, the managing partner's member
 * in `gerenciado`) and `executeProposal` checks everything again
 * (approver, validity, hash, version, module, permission and quota). The
 * outcome is the proposal's; its error code goes to the hand-off. The job
 * `core.proposal-execute` stays only for runs queued before H4.
 */
export const proposalExecuteSubscriber = defineSubscriber({
  key: "proposals.execute",
  moduleKey: "core",
  eventTypes: ["proposals.approved"],
  description:
    "Executa a proposta aprovada no contexto de quem aprovou, reconferindo tudo.",
  async handle(tx, event) {
    const proposalId = event.subjectId;
    if (
      !proposalId ||
      !UUID.test(proposalId) ||
      !event.createdBy ||
      !event.workspaceId ||
      !event.organizationId
    ) {
      return { status: "skipped", reason: "invalid_event" };
    }
    const ctx: RequestContext = {
      userId: event.createdBy,
      workspaceId: event.workspaceId,
      organizationId: event.organizationId,
      partnerId: event.partnerId,
      principalType: "user",
    };
    const result = await withRequesterContext(tx, ctx, (inner) =>
      executeProposal(inner, ctx, proposalId, { causedBy: event.id }),
    );
    return {
      status: "done",
      reason:
        result.status === "executed" ? null : (result.error ?? result.status),
    };
  },
});
