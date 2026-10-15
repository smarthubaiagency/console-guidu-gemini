import "server-only";

import type { PrismaClient } from "@prisma/client";

import { recordAudit } from "@/core/audit/record";
import { decryptSecret, encryptSecret } from "@/core/credentials/crypto";
import {
  getEffectiveWorkspaceRole,
  PermissionDeniedError,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import type { WorkspaceRole } from "@/core/permissions/roles";
import { readCascade } from "@/core/settings/read";
import { resolveSettings } from "@/core/settings/resolve";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import type { VerificationStatus } from "./apps";
import {
  googleProvider,
  googleRedirectUri,
  type GoogleOAuthProvider,
} from "./provider";
import { type GoogleScope, isGoogleScope, scopesFromGrant } from "./scopes";
import {
  createNonce,
  createPkce,
  GOOGLE_STATE_TTL_MS,
  type GoogleFlowState,
  signGoogleState,
} from "./state";

/**
 * The Google account of a workspace (CF6b, plano G1): owner and admin
 * connect it by OAuth and disconnect it; the tokens stay encrypted in the
 * database and never reach a page. The workspace uses its partner's app
 * when the partner registered one, else the GUIDU's. The scopes asked are
 * the ones the platform and the partner offer. The G1 tools come later.
 */

export type WorkspaceGoogleApp = Readonly<{
  source: "platform" | "partner";
  appId: string;
  clientId: string;
  clientSecretEncrypted: string;
  verificationStatus: VerificationStatus;
}>;

export type GoogleConnectionSummary = Readonly<{
  email: string;
  scopes: GoogleScope[];
  appSource: "platform" | "partner";
  connectedAt: Date;
}>;

export type GoogleWorkspaceView = Readonly<{
  canManage: boolean;
  app: Readonly<{
    source: "platform" | "partner";
    verificationStatus: VerificationStatus;
  }> | null;
  /** Scopes offered to the workspace (platform, narrowed by the partner). */
  scopes: GoogleScope[];
  connection: GoogleConnectionSummary | null;
  /** Why connecting is not possible now, if it is not. */
  blocked: "no_app" | "no_scopes" | "no_redirect" | null;
}>;

function failure(key: string, message: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `integrations.google.errors.${key}`,
  });
}

async function canManage(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<boolean> {
  const role = await getEffectiveWorkspaceRole(tx, ctx);
  return role
    ? workspaceRoleGrants(role as WorkspaceRole, "workspace.settings.update")
    : false;
}

/** The app the workspace connects with (owner and admin only). */
export async function workspaceGoogleApp(
  tx: ContextTransaction,
): Promise<WorkspaceGoogleApp | null> {
  const rows = await tx.$queryRaw<
    {
      source: string;
      app_id: string;
      client_id: string;
      client_secret_encrypted: string;
      verification_status: string;
    }[]
  >`select source, app_id, client_id, client_secret_encrypted, verification_status
    from private.google_oauth_app_for_workspace()`;
  const row = rows[0];
  if (!row) return null;
  return {
    source: row.source === "partner" ? "partner" : "platform",
    appId: row.app_id,
    clientId: row.client_id,
    clientSecretEncrypted: row.client_secret_encrypted,
    verificationStatus: row.verification_status as VerificationStatus,
  };
}

async function offeredScopes(tx: ContextTransaction): Promise<GoogleScope[]> {
  return resolveSettings(await readCascade(tx)).values[
    "integrations.google.scopes"
  ];
}

export async function googleWorkspaceView(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<GoogleWorkspaceView> {
  const manage = await canManage(tx, ctx);
  const scopes = await offeredScopes(tx);
  if (!manage) {
    return {
      canManage: false,
      app: null,
      scopes,
      connection: null,
      blocked: null,
    };
  }
  const app = await workspaceGoogleApp(tx);
  const row = await tx.workspaceGoogleConnection.findUnique({
    where: { workspaceId: ctx.workspaceId },
    select: {
      accountEmail: true,
      scopes: true,
      appSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    canManage: true,
    app: app
      ? { source: app.source, verificationStatus: app.verificationStatus }
      : null,
    scopes,
    connection: row
      ? {
          email: row.accountEmail,
          scopes: row.scopes.filter(isGoogleScope),
          appSource: row.appSource === "partner" ? "partner" : "platform",
          connectedAt: row.updatedAt ?? row.createdAt,
        }
      : null,
    blocked: !app
      ? "no_app"
      : scopes.length === 0
        ? "no_scopes"
        : !googleRedirectUri()
          ? "no_redirect"
          : null,
  };
}

export type GoogleConnectStart = Readonly<{
  url: string;
  nonce: string;
  verifier: string;
}>;

/**
 * Starts the connection: checks the role, the app and the scopes, and
 * returns Google's consent URL with a signed state and the PKCE challenge.
 * The caller keeps the nonce and the verifier in the flow cookie.
 */
export async function startGoogleConnection(
  tx: ContextTransaction,
  ctx: RequestContext,
  input: Readonly<{ workspaceSlug: string; returnOrigin: string }>,
  provider: GoogleOAuthProvider = googleProvider(),
  now: number = Date.now(),
): Promise<GoogleConnectStart> {
  if (!(await canManage(tx, ctx))) throw new PermissionDeniedError();
  const app = await workspaceGoogleApp(tx);
  if (!app) {
    throw failure(
      "noApp",
      "A integração com o Google ainda não foi configurada.",
    );
  }
  const scopes = await offeredScopes(tx);
  if (scopes.length === 0) {
    throw failure("noScopes", "Nenhum escopo do Google está liberado.");
  }
  const redirectUri = googleRedirectUri();
  if (!redirectUri) {
    throw failure(
      "noRedirect",
      "Endereço de retorno não configurado (APP_URL).",
    );
  }
  const pkce = createPkce();
  const nonce = createNonce();
  const state: GoogleFlowState = {
    workspaceId: ctx.workspaceId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    workspaceSlug: input.workspaceSlug,
    returnOrigin: input.returnOrigin,
    appId: app.appId,
    nonce,
    expiresAt: now + GOOGLE_STATE_TTL_MS,
  };
  const url = provider.authorizeUrl({
    clientId: app.clientId,
    redirectUri,
    scopes,
    state: signGoogleState(state),
    codeChallenge: pkce.challenge,
  });
  await recordAudit(tx, ctx, {
    action: "workspace.google.connect_start",
    resourceType: "google_connection",
    resourceId: ctx.workspaceId,
    result: "success",
    origin: "app",
    metadata: { scopes, kind: app.source },
  });
  return { url, nonce, verifier: pkce.verifier };
}

/**
 * Ends the connection after Google's consent, under the session of the
 * person who started (the caller checked the state, the session and the
 * cookie). The exchange runs outside any transaction; the account is saved
 * in a second one, which checks the role again.
 */
export async function completeGoogleConnection(
  prisma: PrismaClient,
  ctx: RequestContext,
  input: Readonly<{ code: string; verifier: string; appId: string }>,
  provider: GoogleOAuthProvider = googleProvider(),
): Promise<GoogleConnectionSummary> {
  const app = await withContext(prisma, ctx, async (tx) => {
    if (!(await canManage(tx, ctx))) throw new PermissionDeniedError();
    return workspaceGoogleApp(tx);
  });
  if (!app || app.appId !== input.appId) {
    throw failure(
      "appChanged",
      "O app do Google mudou durante a conexão. Tente de novo.",
    );
  }
  const redirectUri = googleRedirectUri();
  if (!redirectUri) {
    throw failure(
      "noRedirect",
      "Endereço de retorno não configurado (APP_URL).",
    );
  }
  const tokens = await provider.exchangeCode({
    code: input.code,
    codeVerifier: input.verifier,
    clientId: app.clientId,
    clientSecret: decryptSecret(app.clientSecretEncrypted),
    redirectUri,
  });

  return withContext(prisma, ctx, async (tx) => {
    if (!(await canManage(tx, ctx))) throw new PermissionDeniedError();
    const offered = await offeredScopes(tx);
    const granted = scopesFromGrant(tokens.grantedScope).filter((scope) =>
      offered.includes(scope),
    );
    const access = encryptSecret(tokens.accessToken).encryptedPayload;
    const refresh = tokens.refreshToken
      ? encryptSecret(tokens.refreshToken).encryptedPayload
      : null;
    const data = {
      appSource: app.source,
      appId: app.appId,
      accountEmail: tokens.email,
      accountSubject: tokens.subject,
      scopes: granted,
      accessTokenEncrypted: access,
      refreshTokenEncrypted: refresh,
      accessExpiresAt: tokens.expiresAt,
      connectedBy: ctx.userId,
    };
    const existing = await tx.workspaceGoogleConnection.findUnique({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    const saved = existing
      ? await tx.workspaceGoogleConnection.update({
          where: { id: existing.id },
          data: { ...data, updatedAt: new Date() },
          select: { createdAt: true, updatedAt: true },
        })
      : await tx.workspaceGoogleConnection.create({
          data: {
            ...data,
            organizationId: ctx.organizationId,
            workspaceId: ctx.workspaceId,
          },
          select: { createdAt: true, updatedAt: true },
        });
    await recordAudit(tx, ctx, {
      action: "workspace.google.connect",
      resourceType: "google_connection",
      resourceId: ctx.workspaceId,
      result: "success",
      origin: "app",
      metadata: {
        scopes: granted,
        kind: app.source,
        emailDomain: tokens.email.split("@")[1] ?? null,
      },
    });
    return {
      email: tokens.email,
      scopes: granted,
      appSource: app.source,
      connectedAt: saved.updatedAt,
    };
  });
}

/**
 * Disconnects the workspace's account: the row goes at once; the token is
 * then revoked at Google, best effort (a failure there changes nothing on
 * our side).
 */
export async function disconnectGoogle(
  prisma: PrismaClient,
  ctx: RequestContext,
  provider: GoogleOAuthProvider = googleProvider(),
): Promise<boolean> {
  const token = await withContext(prisma, ctx, async (tx) => {
    if (!(await canManage(tx, ctx))) throw new PermissionDeniedError();
    const rows = await tx.$queryRaw<
      {
        access_token_encrypted: string;
        refresh_token_encrypted: string | null;
      }[]
    >`select access_token_encrypted, refresh_token_encrypted
      from private.workspace_google_tokens()`;
    const row = rows[0];
    if (!row) return undefined;
    await tx.workspaceGoogleConnection.deleteMany({
      where: { workspaceId: ctx.workspaceId },
    });
    await recordAudit(tx, ctx, {
      action: "workspace.google.disconnect",
      resourceType: "google_connection",
      resourceId: ctx.workspaceId,
      result: "success",
      origin: "app",
    });
    try {
      return decryptSecret(
        row.refresh_token_encrypted ?? row.access_token_encrypted,
      );
    } catch {
      return null;
    }
  });
  if (token === undefined) return false;
  if (token) {
    await provider.revoke(token).catch((error: unknown) => {
      appLog.warn("google.revoke_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
    });
  }
  return true;
}
