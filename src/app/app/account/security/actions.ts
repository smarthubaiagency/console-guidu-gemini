"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUTH_MESSAGES } from "@/core/auth/form-state";
import { requireUser } from "@/core/auth/identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { EnrolmentState } from "./enrolment-state";

/**
 * Starts TOTP enrolment. The factor exists in `unverified` state until a valid
 * code confirms it, so an abandoned enrolment never grants aal2.
 */
export async function startTotpEnrolment(): Promise<EnrolmentState> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `TOTP ${new Date().toISOString().slice(0, 10)}`,
  });

  if (error || !data) return { error: AUTH_MESSAGES.unavailable };

  return {
    factorId: data.id,
    uri: data.totp.uri,
    secret: data.totp.secret,
  };
}

const ConfirmInput = z.object({
  factorId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

/** Confirms the enrolment with a code from the authenticator app. */
export async function confirmTotpEnrolment(
  previous: EnrolmentState,
  formData: FormData,
): Promise<EnrolmentState> {
  await requireUser();

  const parsed = ConfirmInput.safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
  });

  if (!parsed.success)
    return { ...previous, error: AUTH_MESSAGES.invalidMfaCode };

  const supabase = await createSupabaseServerClient();

  const challenge = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });
  if (challenge.error || !challenge.data) {
    return { ...previous, error: AUTH_MESSAGES.invalidMfaCode };
  }

  const { error } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.data.id,
    code: parsed.data.code,
  });

  if (error) return { ...previous, error: AUTH_MESSAGES.invalidMfaCode };

  revalidatePath("/app/account/security");
  return { message: "Verificação em duas etapas ativada." };
}

const UnenrolInput = z.object({ factorId: z.string().min(1) });

/** Removes a factor. Requires an active identity; the Auth server owns the rest. */
export async function unenrolTotpFactor(formData: FormData): Promise<void> {
  await requireUser();

  const parsed = UnenrolInput.safeParse({ factorId: formData.get("factorId") });
  if (!parsed.success) return;

  const supabase = await createSupabaseServerClient();
  await supabase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
  revalidatePath("/app/account/security");
}
