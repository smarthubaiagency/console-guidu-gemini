import type { PrismaClient } from "@prisma/client";

import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { displayName, ensureAccountRow, myInboxMemberships } from "./accounts";
import { matrixConfig, type MatrixConfig } from "./config";
import { requestAccountSync } from "./jobs";
import { signLoginToken } from "./jwt";
import { createSynapseClient, type MatrixFetch, upsertUser } from "./synapse";

/**
 * Matrix session of the browser (IN3, ADR 0023 rule 9). The console, with
 * the person already signed in, makes sure their account exists and is
 * active, asks the worker to put it in the rooms of their workspaces, and
 * hands over a 60-second RS256 token for `org.matrix.login.jwt`. Only for
 * someone with `inbox.view` in an active workspace. The browser keeps the
 * Matrix session it gets (with its refresh token) and asks again only when
 * it has none (IN4).
 */

export type MatrixSession = Readonly<{
  homeserverUrl: string;
  userId: string;
  loginToken: string;
  expiresAt: string;
}>;

export function matrixUnavailable(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "O chat não está disponível.",
    messageKey: "errors.chatUnavailable",
  });
}

export async function createMatrixSession(
  prisma: PrismaClient,
  userId: string,
  options: Readonly<{ config?: MatrixConfig | null; fetch?: MatrixFetch }> = {},
): Promise<MatrixSession> {
  const config = options.config === undefined ? matrixConfig() : options.config;
  if (!config) throw matrixUnavailable();

  const { account, name } = await withIdentityContext(
    prisma,
    userId,
    async (tx) => {
      const memberships = await myInboxMemberships(tx);
      if (memberships.length === 0) {
        throw new AppError({
          code: "forbidden",
          safeMessage: "Você não tem permissão para esta ação.",
          messageKey: "errors.permissionDenied",
        });
      }
      const row = await ensureAccountRow(tx, config, userId);
      if (row.status !== "active") {
        await tx.matrixAccount.update({
          where: { profileId: userId },
          data: { status: "active", deactivatedAt: null },
        });
      }
      await requestAccountSync(tx, userId);
      return { account: row, name: displayName(memberships[0]?.fullName) };
    },
  );

  try {
    await upsertUser(
      createSynapseClient(config, options.fetch),
      account.mxid,
      name,
    );
  } catch (error) {
    console.error(
      "[matrix] account not provisioned",
      String(error).slice(0, 200),
    );
    throw new AppError({
      code: "unavailable",
      safeMessage: "O chat está indisponível no momento.",
      messageKey: "errors.chatUnavailable",
      cause: error,
    });
  }

  const { token, expiresAt } = signLoginToken(config, {
    localpart: account.localpart,
    displayName: name,
  });
  return {
    homeserverUrl: config.homeserverUrl,
    userId: account.mxid,
    loginToken: token,
    expiresAt: expiresAt.toISOString(),
  };
}
