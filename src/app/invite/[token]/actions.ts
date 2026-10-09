"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma/client";
import { requireUser } from "@/core/auth/identity";
import { acceptInvitation } from "@/core/organizations/invitations";
import {
  InvitationAlreadyAcceptedError,
  InvitationEmailUnconfirmedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRecipientMismatchError,
  InvitationRevokedError,
  SeatLimitExceededError,
} from "@/core/organizations/errors";

export type AcceptInvitationState = {
  error?: string;
  errorCode?:
    | "expired"
    | "revoked"
    | "already_accepted"
    | "recipient_mismatch"
    | "seat_limit_exceeded"
    | "not_found"
    | "email_unconfirmed";
};

export async function acceptInvitationAction(
  rawToken: string,
): Promise<AcceptInvitationState> {
  const identity = await requireUser();
  let targetPath = "/app";

  try {
    const result = await acceptInvitation(prisma, {
      rawToken,
      identity,
    });

    if (result.workspaceSlug) {
      targetPath = `/app/${result.workspaceSlug}`;
    }
  } catch (err: unknown) {
    if (err instanceof InvitationExpiredError) {
      return { error: "Este convite expirou.", errorCode: "expired" };
    }
    if (err instanceof InvitationRevokedError) {
      return {
        error: "Este convite foi revogado por um administrador.",
        errorCode: "revoked",
      };
    }
    if (err instanceof InvitationAlreadyAcceptedError) {
      return {
        error: "Este convite já foi aceito.",
        errorCode: "already_accepted",
      };
    }
    if (err instanceof InvitationRecipientMismatchError) {
      return {
        error: "Este convite foi enviado para outro e-mail.",
        errorCode: "recipient_mismatch",
      };
    }
    if (err instanceof SeatLimitExceededError) {
      return {
        error: "O limite de vagas desta organização foi atingido.",
        errorCode: "seat_limit_exceeded",
      };
    }
    if (err instanceof InvitationEmailUnconfirmedError) {
      return {
        error: "O e-mail precisa estar confirmado para aceitar o convite.",
        errorCode: "email_unconfirmed",
      };
    }
    if (err instanceof InvitationNotFoundError) {
      return {
        error: "Convite não encontrado ou inválido.",
        errorCode: "not_found",
      };
    }
    return { error: "Não foi possível aceitar o convite. Tente novamente." };
  }

  redirect(targetPath);
}
