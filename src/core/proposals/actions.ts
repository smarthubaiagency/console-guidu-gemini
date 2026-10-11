"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";

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
    const t = await getTranslations("proposals");
    return { success: true, message: t("actions.approved") };
  } catch (err) {
    return actionFailure(err);
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
    const t = await getTranslations("proposals");
    return { success: true, message: t("actions.rejected") };
  } catch (err) {
    return actionFailure(err);
  }
}
