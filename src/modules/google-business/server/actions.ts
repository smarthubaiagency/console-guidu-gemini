"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { partnerActor } from "@/core/partners/actors";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AppError, type AppErrorCode } from "@/shared/errors";

import { AUTOMATION_AREAS, type AutomationArea } from "../areas";
import { googleBusinessProvider } from "../provider";
import { type GbAccess, resolveAdminAccess, resolveAppAccess } from "./access";
import { saveArea, type SaveAreaResult } from "./automation";
import {
  callbackUrl,
  GB_CONNECT_COOKIE,
  GB_CONNECT_TTL_MS,
  newConnectFlow,
  openConnectFlow,
  sameTarget,
  sealConnectFlow,
} from "./connect-flow";
import {
  AttachInput,
  attachUnit,
  blockingSteps,
  finishOnboarding,
  type PreparedLocation,
  prepareLocation,
  runBlockingAnalysis,
} from "./onboarding";
import { gbForbidden } from "./errors";
import type { Db } from "./runner";
import { askLocationSpecialist } from "./specialist";
import { automationPath, type GbTarget, GbTargetSchema } from "./target";

/**
 * Server actions of the onboarding window, the automation page and the
 * specialist drawer (GB1a). Each one resolves the target again (session,
 * partner console with MFA, mode of the company) and the services check the
 * manager inside the transaction; RLS repeats it.
 */

type Failure = { error: string; code: AppErrorCode; requestId: string };
type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);

async function fail(err: unknown): Promise<{ ok: false } & Failure> {
  return { ok: false, ...(await actionFailure(err)) };
}

function invalid(): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: "Dados inválidos.",
    messageKey: "googleBusiness.errors.invalidInput",
  });
}

async function resolve(target: unknown): Promise<GbAccess> {
  const parsed = GbTargetSchema.safeParse(target);
  if (!parsed.success) throw invalid();
  if (parsed.data.scope === "app") {
    const identity = await requireUser();
    return resolveAppAccess(identity.userId, parsed.data.workspaceSlug);
  }
  const actor = await partnerActor();
  return resolveAdminAccess(actor, parsed.data.workspaceId);
}

async function manager(target: unknown): Promise<GbAccess> {
  const access = await resolve(target);
  if (!access.canManage) throw gbForbidden();
  return access;
}

function dbOf(access: GbAccess): Db {
  return (operation) => withContext(prisma, access.ctx, operation);
}

const id = z.uuid();

async function requestOrigin(): Promise<string> {
  const origin = await getRequestOrigin();
  if (!origin) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Endereço de retorno não configurado (APP_URL).",
      messageKey: "googleBusiness.errors.noOrigin",
    });
  }
  return origin;
}

/** Pending connection of this person and target, from the flow cookie. */
async function pendingOf(access: GbAccess): Promise<string> {
  const flow = openConnectFlow((await cookies()).get(GB_CONNECT_COOKIE)?.value);
  if (
    !flow?.pending ||
    flow.userId !== access.ctx.userId ||
    !sameTarget(flow.target, access.target)
  ) {
    throw new AppError({
      code: "conflict",
      safeMessage: "A conexão com o Google expirou. Entre de novo.",
      messageKey: "googleBusiness.errors.connectionExpired",
    });
  }
  return flow.pending;
}

/** Step "Conectar": the URL of Google's consent. */
export async function startConnectAction(
  target: GbTarget,
): Promise<Result<{ url: string }>> {
  try {
    const access = await manager(target);
    const origin = await requestOrigin();
    const flow = newConnectFlow(access.ctx.userId, access.target);
    const url = await googleBusinessProvider().connectUrl({
      returnUrl: callbackUrl(origin, flow.nonce),
    });
    (await cookies()).set(GB_CONNECT_COOKIE, sealConnectFlow(flow), {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: GB_CONNECT_TTL_MS / 1000,
    });
    return { ok: true, url };
  } catch (err) {
    return fail(err);
  }
}

/** Step "Ler e analisar", first part: reads the chosen ficha. */
export async function prepareLocationAction(
  target: GbTarget,
  optionId: string,
): Promise<Result<PreparedLocation>> {
  try {
    if (!z.string().min(1).max(300).safeParse(optionId).success) {
      throw invalid();
    }
    const access = await manager(target);
    const pending = await pendingOf(access);
    const prepared = await prepareLocation(
      dbOf(access),
      access.ctx,
      googleBusinessProvider(),
      pending,
      optionId,
    );
    return { ok: true, ...prepared };
  } catch (err) {
    return fail(err);
  }
}

/** Links the ficha to a unit (an existing one, or a new one from the ficha). */
export async function attachUnitAction(
  target: GbTarget,
  locationId: string,
  unitId: string | null,
): Promise<
  Result<{ created: boolean; steps: { key: string; labelKey: string }[] }>
> {
  try {
    const choice = AttachInput.safeParse(
      unitId ? { unitId } : { create: true },
    );
    if (!id.safeParse(locationId).success || !choice.success) throw invalid();
    const access = await manager(target);
    const result = await withContext(prisma, access.ctx, (tx) =>
      attachUnit(tx, access.ctx, locationId, choice.data),
    );
    return { ok: true, created: result.created, steps: blockingSteps() };
  } catch (err) {
    return fail(err);
  }
}

/** One blocking analysis (one step of the window). */
export async function runStepAction(
  target: GbTarget,
  locationId: string,
  analysisKey: string,
): Promise<Result<{ status: string; findings: number }>> {
  try {
    if (!id.safeParse(locationId).success) throw invalid();
    const access = await manager(target);
    const result = await runBlockingAnalysis(
      dbOf(access),
      access.ctx,
      locationId,
      analysisKey,
    );
    return { ok: true, ...result };
  } catch (err) {
    return fail(err);
  }
}

/** Step "Pronto": queues the background analyses, counts the points. */
export async function finishOnboardingAction(
  target: GbTarget,
  locationId: string,
): Promise<Result<{ points: number; background: number; href: string }>> {
  try {
    if (!id.safeParse(locationId).success) throw invalid();
    const access = await manager(target);
    const href = automationPath(access.target, locationId);
    const origin = await getRequestOrigin();
    const result = await withContext(prisma, access.ctx, (tx) =>
      finishOnboarding(
        tx,
        access.ctx,
        locationId,
        origin ? new URL(href, origin).toString() : null,
      ),
    );
    (await cookies()).delete(GB_CONNECT_COOKIE);
    revalidatePath(href);
    return { ok: true, ...result, href };
  } catch (err) {
    return fail(err);
  }
}

/** Saves an area; with `approve`, "Aprovado, pode seguir". */
export async function saveAreaAction(
  target: GbTarget,
  locationId: string,
  input: Readonly<{
    area: AutomationArea;
    enabled: boolean;
    autonomy: string;
    approve: boolean;
  }>,
): Promise<Result<SaveAreaResult>> {
  try {
    if (!id.safeParse(locationId).success) throw invalid();
    const access = await manager(target);
    const result = await withContext(prisma, access.ctx, (tx) =>
      saveArea(tx, access.ctx, locationId, input as never),
    );
    revalidatePath(automationPath(access.target, locationId));
    return { ok: true, ...result };
  } catch (err) {
    return fail(err);
  }
}

/** "Preciso saber mais": a question to the GMN specialist (answers only). */
export async function askSpecialistAction(
  target: GbTarget,
  locationId: string,
  input: Readonly<{
    question: string;
    history: { role: "user" | "assistant"; content: string }[];
    area: string | null;
  }>,
): Promise<Result<{ text: string }>> {
  try {
    if (!id.safeParse(locationId).success) throw invalid();
    const access = await resolve(target);
    const area =
      input.area && (AUTOMATION_AREAS as readonly string[]).includes(input.area)
        ? (input.area as AutomationArea)
        : null;
    const answer = await askLocationSpecialist(
      dbOf(access),
      access.ctx,
      locationId,
      { question: input.question, history: input.history },
      {
        area,
        locale: await getLocale(),
        origin: access.actor === "partner" ? "admin" : "app",
      },
    );
    return { ok: true, text: answer.text };
  } catch (err) {
    return fail(err);
  }
}
