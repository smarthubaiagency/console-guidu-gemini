"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { invalidateDomainCheck, releaseHost, verifyHost } from "./runtime";
import {
  addPartnerCustomDomain,
  addWorkspaceDomain,
  getPartnerCustomDomain,
  getWorkspaceDomain,
  listPartnerCustomerWorkspaces,
  recordPartnerDomainCheck,
  recordWorkspaceDomainCheck,
  removePartnerCustomDomain,
  removeWorkspaceDomain,
  setPrimaryWorkspaceDomain,
  type WorkspaceDomainActor,
} from "./service";
import type { DomainCheckResult } from "./verify";

/**
 * Server actions of the domain screens (CF2b). Verification reads the
 * domain, checks DNS and Cloudflare outside any transaction and then writes
 * the result, so no transaction waits on the network.
 */

type State = PartnerActionState;

const Text = z.string().trim().min(1).max(300);

function field(formData: FormData, name: string): string {
  return Text.parse(formData.get(name));
}

async function done(
  key: string,
  values?: Record<string, string>,
): Promise<State> {
  const t = await getTranslations("domains");
  revalidatePath("/", "layout");
  return { success: true, message: t(key, values) };
}

function checkMessage(result: DomainCheckResult): string {
  return result.status === "active"
    ? "messages.active"
    : `messages.${result.lastError ?? "dns_pending"}`;
}

// ----------------------------------------------------------------------------
// /admin › Configurações › Domínios: the partner's dashboard domains
// ----------------------------------------------------------------------------

async function inPartner<T>(
  actor: Awaited<ReturnType<typeof partnerActor>>,
  run: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  return withIdentityContext(prisma, actor.userId, run, {
    partnerId: actor.partnerId,
  });
}

export async function addPartnerDomainAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const { host } = await inPartner(actor, (tx) =>
      addPartnerCustomDomain(tx, actor, field(formData, "host")),
    );
    return done("messages.added", { host });
  } catch (err) {
    return actionFailure(err);
  }
}

export async function verifyPartnerDomainAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const host = field(formData, "host");
    const current = await inPartner(actor, (tx) =>
      getPartnerCustomDomain(tx, actor, host),
    );
    const result = await verifyHost(current.host, current);
    await inPartner(actor, (tx) =>
      recordPartnerDomainCheck(tx, actor, current.host, result),
    );
    await invalidateDomainCheck(current.host);
    return done(checkMessage(result));
  } catch (err) {
    return actionFailure(err);
  }
}

export async function removePartnerDomainAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const removed = await inPartner(actor, (tx) =>
      removePartnerCustomDomain(tx, actor, field(formData, "host")),
    );
    await releaseHost(removed.host, removed.cloudflareHostnameId);
    return done("messages.removed", { host: removed.host });
  } catch (err) {
    return actionFailure(err);
  }
}

// ----------------------------------------------------------------------------
// Public domains of a workspace: /app (the workspace) and /admin (partner)
// ----------------------------------------------------------------------------

/** Runs with the actor of the screen the form came from. */
async function asWorkspaceActor<T>(
  formData: FormData,
  run: (tx: ContextTransaction, actor: WorkspaceDomainActor) => Promise<T>,
): Promise<T> {
  const slug = formData.get("workspaceSlug");
  if (typeof slug === "string" && slug.length > 0) {
    const identity = await requireUser();
    const ctx = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      z.string().min(1).max(64).parse(slug),
    );
    return withContext(prisma, ctx, (tx) =>
      run(tx, { kind: "workspace", userId: identity.userId, ctx }),
    );
  }
  const actor = await partnerActor();
  return inPartner(actor, (tx) =>
    run(tx, {
      kind: "partner",
      userId: actor.userId,
      partnerId: actor.partnerId,
      partnerRole: actor.partnerRole,
    }),
  );
}

export async function addWorkspaceDomainAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const host = field(formData, "host");
    const added = await asWorkspaceActor(formData, async (tx, actor) => {
      if (actor.kind === "workspace") {
        return addWorkspaceDomain(tx, actor, actor.ctx, host);
      }
      // From /admin: the workspace must be one of the partner's customers.
      const workspaceId = field(formData, "workspaceId");
      const target = (await listPartnerCustomerWorkspaces(tx)).find(
        (row) => row.workspaceId === workspaceId,
      );
      if (!target) {
        throw new AppError({
          code: "not_found",
          safeMessage: "Workspace não encontrado.",
          messageKey: "domains.errors.workspaceNotFound",
        });
      }
      return addWorkspaceDomain(tx, actor, target, host);
    });
    return done("messages.added", { host: added.host });
  } catch (err) {
    return actionFailure(err);
  }
}

export async function verifyWorkspaceDomainAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const id = field(formData, "domainId");
    const current = await asWorkspaceActor(formData, (tx, actor) =>
      getWorkspaceDomain(tx, actor, id),
    );
    const result = await verifyHost(current.host, current);
    await asWorkspaceActor(formData, (tx, actor) =>
      recordWorkspaceDomainCheck(tx, actor, id, result),
    );
    await invalidateDomainCheck(current.host);
    return done(checkMessage(result));
  } catch (err) {
    return actionFailure(err);
  }
}

export async function primaryWorkspaceDomainAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const id = field(formData, "domainId");
    await asWorkspaceActor(formData, (tx, actor) =>
      setPrimaryWorkspaceDomain(tx, actor, id),
    );
    return done("messages.primary");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function removeWorkspaceDomainAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const id = field(formData, "domainId");
    const removed = await asWorkspaceActor(formData, (tx, actor) =>
      removeWorkspaceDomain(tx, actor, id),
    );
    await releaseHost(removed.host, removed.cloudflareHostnameId);
    return done("messages.removed", { host: removed.host });
  } catch (err) {
    return actionFailure(err);
  }
}
