"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isAccessDeniedError } from "@/core/auth/errors";
import { AUTH_MESSAGES, type AuthFormState } from "@/core/auth/form-state";
import { requireUser } from "@/core/auth/identity";
import { safeInternalPath } from "@/core/auth/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ChallengeInput = z.object({
  factorId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
  next: z.string().optional(),
});

/**
 * Completes the second factor of an existing aal1 session. On success the
 * Auth server issues a new access token with `aal: aal2`, which is what
 * `requireMfa()` looks for.
 */
export async function verifyMfaChallenge(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = ChallengeInput.safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) return { error: AUTH_MESSAGES.invalidMfaCode };

  // Revalidate the identity's server-side status before touching Auth: the
  // page that rendered this form may have been open since before an
  // administrator blocked the identity, and the JWT alone would still look
  // valid (specification section 8, AC03).
  try {
    await requireUser();
  } catch (error) {
    if (isAccessDeniedError(error)) redirect(error.route(parsed.data.next));
    throw error;
  }

  const supabase = await createSupabaseServerClient();

  const challenge = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });
  if (challenge.error || !challenge.data) {
    return { error: AUTH_MESSAGES.invalidMfaCode };
  }

  const { error } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.data.id,
    code: parsed.data.code,
  });

  if (error) return { error: AUTH_MESSAGES.invalidMfaCode };

  redirect(safeInternalPath(parsed.data.next));
}
