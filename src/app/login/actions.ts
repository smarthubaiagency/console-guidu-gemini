"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { AUTH_MESSAGES, type AuthFormState } from "@/core/auth/form-state";
import { provisionIdentity } from "@/core/auth/identity";
import { safeInternalPath } from "@/core/auth/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SignInInput = z.object({
  email: z.email().trim(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function signInWithPassword(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = SignInInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) return { error: AUTH_MESSAGES.invalidInput };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // One message for wrong password, unknown e-mail and unconfirmed e-mail: the
  // form must not become an account-existence oracle.
  if (error) return { error: AUTH_MESSAGES.invalidCredentials };

  const { decision } = await provisionIdentity();

  if (!decision.allowed && decision.reason === "identity_blocked") {
    // Drop the session immediately; a blocked identity keeps nothing usable.
    await supabase.auth.signOut();
    redirect("/auth/suspended");
  }

  if (!decision.allowed) redirect("/login?error=unavailable");

  // Password alone is aal1. When the identity has a verified factor, Supabase
  // reports aal2 as the next level and the session is only complete after the
  // TOTP challenge.
  const { data: assurance } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const target = safeInternalPath(parsed.data.next);

  if (
    assurance?.nextLevel === "aal2" &&
    assurance.currentLevel !== assurance.nextLevel
  ) {
    redirect(`/auth/mfa?next=${encodeURIComponent(target)}`);
  }

  redirect(target);
}
