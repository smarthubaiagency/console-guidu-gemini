import "server-only";

import { generateText, type ModelMessage } from "ai";
import { z } from "zod";

import { decryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import { withBaseUrl } from "../catalog";
import { parseAgentConfig } from "../config/schema";
import {
  type ChatModelKey,
  createChatModel,
  type ModelFactory,
} from "../providers";
import { turnErrorCode } from "../turn/plan";
import type { SpecialistDefinition } from "./definitions";

/**
 * A question to a specialist (ADR 0019, GB1a): one call, no tools, with our
 * key: the model and admin key of the Assistant of the partner serving the
 * context (the platform's on the house partner), read by the same security
 * definer functions as the Assistant's turn. History stays with the screen
 * (a few messages), nothing is stored but the audit of the caller.
 *
 * Tests and e2e answer with a fixed text (`GOOGLE_BUSINESS_SPECIALIST_PROVIDER=fake`,
 * refused in production).
 */

export const SPECIALIST_LIMITS = {
  question: 2000,
  history: 8,
  context: 12_000,
  maxOutputTokens: 800,
  totalMs: 45_000,
} as const;

export const SpecialistQuestion = z.strictObject({
  question: z.string().trim().min(1).max(SPECIALIST_LIMITS.question),
  history: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(SPECIALIST_LIMITS.question * 2),
      }),
    )
    .max(SPECIALIST_LIMITS.history)
    .default([]),
});

export type SpecialistAnswer = Readonly<{
  text: string;
  usage: Readonly<{ inputTokens: number; outputTokens: number }>;
  model: string;
}>;

export type SpecialistDeps = Readonly<{
  createModel?: ModelFactory;
  env?: Readonly<Record<string, string | undefined>>;
}>;

export function isFakeSpecialist(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.GOOGLE_BUSINESS_SPECIALIST_PROVIDER?.trim() === "fake";
}

function unavailable(): AppError {
  return new AppError({
    code: "unavailable",
    safeMessage: "O agente ainda não tem chave e modelo de IA.",
    messageKey: "googleBusiness.errors.specialistUnavailable",
  });
}

/** Our key for the context: the Assistant's model and admin key. */
export async function specialistKey(
  tx: ContextTransaction,
): Promise<ChatModelKey> {
  const [runtime] = await tx.$queryRaw<
    { config: unknown; config_version: number }[]
  >`select config, config_version from private.ai_assistant_runtime()`;
  if (!runtime) throw unavailable();
  const parsed = parseAgentConfig(
    "assistant",
    runtime.config_version,
    runtime.config,
  );
  if (!parsed.success) throw unavailable();
  const model = parsed.data.model;
  if (!model.model_name) throw unavailable();
  const [credential] = await tx.$queryRaw<
    { provider: string; encrypted_payload: string }[]
  >`
    select provider, encrypted_payload
    from private.ai_admin_key(
      ${model.credential_id ?? null}::uuid,
      ${model.model_provider ?? null}::text
    )
  `;
  if (!credential) throw unavailable();
  return withBaseUrl(tx, {
    provider: credential.provider as AIProvider,
    secret: decryptSecret(credential.encrypted_payload),
    model: model.model_name,
  });
}

/** The fixed answer of the fake (tests and e2e). */
export function fakeSpecialistAnswer(question: string): string {
  return `Resposta de teste do agente: ${question.slice(0, 200)}`;
}

export async function askSpecialist(
  specialist: SpecialistDefinition,
  input: Readonly<{
    question: string;
    history: readonly { role: "user" | "assistant"; content: string }[];
    /** The ficha, the findings and the areas, as plain text. */
    context: string;
    locale: string;
  }>,
  loadKey: () => Promise<ChatModelKey>,
  deps: SpecialistDeps = {},
): Promise<SpecialistAnswer> {
  if (isFakeSpecialist(deps.env)) {
    return {
      text: fakeSpecialistAnswer(input.question),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "fake",
    };
  }
  const key = await loadKey();
  const messages: ModelMessage[] = [
    ...input.history
      .slice(-SPECIALIST_LIMITS.history)
      .map((m): ModelMessage =>
        m.role === "user"
          ? { role: "user", content: m.content }
          : { role: "assistant", content: m.content },
      ),
    { role: "user", content: input.question },
  ];
  try {
    const result = await generateText({
      model: (deps.createModel ?? createChatModel)(key),
      instructions: `${specialist.instructions}\n\nLanguage of the person: ${input.locale}.\n\nContext:\n${input.context.slice(0, SPECIALIST_LIMITS.context)}`,
      messages,
      maxOutputTokens: SPECIALIST_LIMITS.maxOutputTokens,
      maxRetries: 1,
      timeout: { totalMs: SPECIALIST_LIMITS.totalMs },
    });
    const text = result.text.trim();
    if (!text) throw new Error("empty answer");
    return {
      text,
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      },
      model: key.model,
    };
  } catch (error) {
    appLog.warn("ai.specialist.failed", {
      specialist: specialist.key,
      errorCode: turnErrorCode(error),
    });
    throw new AppError({
      code: "unavailable",
      safeMessage: "O agente não conseguiu responder agora. Tente de novo.",
      messageKey: "googleBusiness.errors.specialistFailed",
    });
  }
}
