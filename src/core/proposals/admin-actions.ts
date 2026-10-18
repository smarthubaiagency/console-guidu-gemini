"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

import { partnerProposalContext } from "./partner";
import { approveProposal, rejectProposal } from "./service";

/**
 * Server actions of the /admin queue of proposals (H4): the managing
 * partner decides, with the session at AAL2 (`partnerActor`), bound to the
 * hash shown; the service checks the partner, the mode and everything F4d
 * checks, and RLS repeats it.
 */

type State = PartnerActionState;

const ProposalId = z.uuid();

export async function approvePartnerProposalAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const proposalId = ProposalId.parse(formData.get("proposalId"));
    const payloadHash = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(formData.get("payloadHash"));
    const ctx = await partnerProposalContext(prisma, actor, proposalId);
    // `partnerActor` already required the second factor (AAL2).
    await withContext(prisma, ctx, (tx) =>
      approveProposal(
        tx,
        ctx,
        proposalId,
        { payloadHash },
        { mfaVerified: true },
      ),
    );
    revalidatePath("/admin/proposals");
    const t = await getTranslations("proposals");
    return { success: true, message: t("actions.approved") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function rejectPartnerProposalAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const proposalId = ProposalId.parse(formData.get("proposalId"));
    const ctx = await partnerProposalContext(prisma, actor, proposalId);
    await withContext(prisma, ctx, (tx) => rejectProposal(tx, ctx, proposalId));
    revalidatePath("/admin/proposals");
    const t = await getTranslations("proposals");
    return { success: true, message: t("actions.rejected") };
  } catch (err) {
    return actionFailure(err);
  }
}
