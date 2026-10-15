"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { AUTH_MESSAGES, type AuthFormState } from "@/core/auth/form-state";
import { provisionIdentity } from "@/core/auth/identity";
import { requestLoginMethods } from "@/core/auth/login-methods";
import { appOrigin } from "@/core/auth/origin";
import { safeInternalPath } from "@/core/auth/redirects";
import { getRequestOrigin } from "@/core/partners/resolve";
import { recordAuthEvent } from "@/core/security/auth-events";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { actionFailure } from "@/core/i18n/errors";
import { AppError } from "@/shared/errors";

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

  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: AUTH_MESSAGES.invalidInput,
        messageKey: "auth.errors.invalidInput",
      }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // One message for wrong password, unknown e-mail and unconfirmed e-mail: the
  // form must not become an account-existence oracle.
  if (error) {
    return actionFailure(
      new AppError({
        code: "unauthenticated",
        safeMessage: AUTH_MESSAGES.invalidCredentials,
        messageKey: "auth.errors.invalidCredentials",
      }),
    );
  }

  const { decision } = await provisionIdentity();

  if (!decision.allowed && decision.reason === "identity_blocked") {
    // Drop the session immediately; a blocked identity keeps nothing usable.
    await supabase.auth.signOut();
    redirect("/auth/suspended");
  }

  if (!decision.allowed) redirect("/login?error=unavailable");

  // Segurança › Eventos (CF5a). Failed attempts stay in Supabase Auth: the
  // e-mail of a failed attempt may not even be a user.
  await recordAuthEvent(decision.userId, "auth.sign_in", "success", "password");

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

// ---------------------------------------------------------------------------
// Google and sign-in link by e-mail (CF5b). Both only run when the provider
// is on and the host's cascade offers them (`requestLoginMethods`), however
// the request arrived. Neither creates an account: sign-up stays by
// invitation (Supabase Auth with "Allow new users to sign up" off, and
// `shouldCreateUser: false` for the link).
// ---------------------------------------------------------------------------

function methodUnavailable(): Promise<AuthFormState> {
  return actionFailure(
    new AppError({
      code: "forbidden",
      safeMessage: AUTH_MESSAGES.methodUnavailable,
      messageKey: "auth.errors.methodUnavailable",
    }),
  );
}

function serviceUnavailable(): Promise<AuthFormState> {
  return actionFailure(
    new AppError({
      code: "unavailable",
      safeMessage: AUTH_MESSAGES.unavailable,
      messageKey: "auth.errors.unavailable",
    }),
  );
}

/**
 * Return point of the provider and of the e-mail link: /auth/callback on
 * the host the person is on (APP_URL on platform hosts, the partner domain
 * once it matched an active domain), so the session lands where it started.
 */
async function callbackUrl(next: FormDataEntryValue | null): Promise<string> {
  const origin = (await getRequestOrigin()) ?? appOrigin();
  const target = safeInternalPath(typeof next === "string" ? next : null);
  return `${origin}/auth/callback?next=${encodeURIComponent(target)}`;
}

export async function signInWithGoogle(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await requestLoginMethods()).google) return methodUnavailable();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: await callbackUrl(formData.get("next")),
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) return serviceUnavailable();

  redirect(data.url);
}

const MagicLinkInput = z.object({ email: z.email().trim() });

export async function requestMagicLink(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await requestLoginMethods()).magicLink) return methodUnavailable();

  const requestId = crypto.randomUUID();
  const parsed = MagicLinkInput.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return actionFailure(
      new AppError({
        code: "invalid_input",
        safeMessage: AUTH_MESSAGES.invalidInput,
        messageKey: "auth.errors.invalidInput",
      }),
    );
  }

  const supabase = await createSupabaseServerClient();
  // The answer is the same whether the address has an account or not: the
  // form must not say which addresses exist.
  await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: await callbackUrl(formData.get("next")),
    },
  });

  const message = (await getTranslations("auth"))("messages.magicLinkSent");
  return { message, requestId };
}
