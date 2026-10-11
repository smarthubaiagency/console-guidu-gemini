"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { toSafeError } from "@/shared/errors";

import { approveProposal, rejectProposal } from "./service";

/** Server actions of the proposals screen (F4d): a person decides. */

type State = PartnerActionState;

const Form = z.object({
  workspaceSlug: z.string().min(1).max(64),
  proposalId: z.string().uuid(),
});

async function decide(
  formData: FormData,
  run: (
    tx: ContextTransaction,
    context: RequestContext,
    proposalId: string,
    mfaVerified: boolean,
  ) => Promise<unknown>,
): Promise<void> {
  const identity = await requireUser();
  const { workspaceSlug, proposalId } = Form.parse({
    workspaceSlug: formData.get("workspaceSlug"),
    proposalId: formData.get("proposalId"),
  });
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  await withContext(prisma, context, (tx) =>
    run(tx, context, proposalId, identity.mfaSatisfied),
  );
  revalidatePath(`/app/${workspaceSlug}/proposals`);
}

function failure(err: unknown): State {
  const safe = toSafeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}

export async function approveProposalAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const payloadHash = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(formData.get("payloadHash"));
    await decide(formData, (tx, context, id, mfaVerified) =>
      approveProposal(tx, context, id, { payloadHash }, { mfaVerified }),
    );
    return {
      success: true,
      message: "Proposta aprovada. A execução entrou na fila.",
    };
  } catch (err) {
    return failure(err);
  }
}

export async function rejectProposalAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    await decide(formData, (tx, context, id) =>
      rejectProposal(tx, context, id),
    );
    return { success: true, message: "Proposta rejeitada." };
  } catch (err) {
    return failure(err);
  }
}
