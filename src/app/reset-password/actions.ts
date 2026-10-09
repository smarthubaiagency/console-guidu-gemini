"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { AccessDeniedError } from "@/core/auth/errors";
import { AUTH_MESSAGES, type AuthFormState } from "@/core/auth/form-state";
import { readSessionClaims } from "@/core/auth/identity";
import { readProfile } from "@/core/auth/profiles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, toSafeError } from "@/shared/errors";

const MIN_PASSWORD_LENGTH = 12;

const ResetInput = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    path: ["confirmation"],
  });

export async function completePasswordReset(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = ResetInput.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) {
    const password = formData.get("password");
    const tooShort =
      typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH;
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: tooShort ? AUTH_MESSAGES.weakPassword : "As senhas não coincidem.",
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  // The recovery link established the session; without it there is nothing to
  // update. Validated against the Auth server, not against the cookie.
  const claims = await readSessionClaims();
  if (!claims?.sub) redirect("/login?error=recovery");

  // Revalidate the identity's server-side status before touching Auth: the
  // recovery session may have been issued before an administrator blocked the
  // identity, and the JWT alone would still look valid (specification
  // section 8, AC03).
  const profile = await readProfile(claims.sub);
  if (!profile || profile.status !== "active") {
    redirect(new AccessDeniedError("identity_blocked", 403).route());
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    const safe = toSafeError(
      new AppError({
        code: "invalid_input",
        safeMessage: AUTH_MESSAGES.recoveryLinkInvalid,
      }),
    );
    return { error: safe.safeMessage, code: safe.code, requestId: safe.requestId };
  }

  // Force a fresh sign-in with the new password so the recovery session does
  // not stay usable afterwards.
  await supabase.auth.signOut();
  redirect("/login?notice=password-updated");
}
