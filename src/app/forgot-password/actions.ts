"use server";

import crypto from "node:crypto";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import type { AuthFormState } from "@/core/auth/form-state";
import { appOrigin } from "@/core/auth/origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RecoveryInput = z.object({ email: z.email().trim() });

export async function requestPasswordRecovery(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const requestId = crypto.randomUUID();
  const parsed = RecoveryInput.safeParse({ email: formData.get("email") });
  const message = (await getTranslations("auth"))("messages.recoverySent");

  // Even a malformed address gets the neutral answer: the form must not say
  // which addresses exist.
  if (!parsed.success) return { message, requestId };

  const supabase = await createSupabaseServerClient();
  const origin = await appOrigin();

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=%2Freset-password`,
  });

  return { message, requestId };
}
