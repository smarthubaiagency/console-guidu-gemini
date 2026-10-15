"use client";

import { LogIn, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/core/auth/form-state";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Field, SubmitButton } from "@/shared/ui/form";

import {
  requestMagicLink,
  signInWithGoogle,
  signInWithPassword,
} from "./actions";

export type LoginFormMethods = Readonly<{
  google: boolean;
  magicLink: boolean;
}>;

/**
 * E-mail and password, plus the methods the host offers (CF5b): the link by
 * e-mail reuses the e-mail field; Google is a form of its own, so the
 * password never travels with it.
 */
export function LoginForm({
  next,
  methods = { google: false, magicLink: false },
}: Readonly<{ next: string; methods?: LoginFormMethods }>) {
  const t = useTranslations("auth.login");
  const [state, action, pending] = useActionState(
    signInWithPassword,
    EMPTY_FORM_STATE,
  );
  const [linkState, linkAction, linkPending] = useActionState(
    requestMagicLink,
    EMPTY_FORM_STATE,
  );
  const [googleState, googleAction, googlePending] = useActionState(
    signInWithGoogle,
    EMPTY_FORM_STATE,
  );
  useActionStatus(state);
  useActionStatus(linkState);
  useActionStatus(googleState);
  const busy = pending || linkPending || googlePending;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <Field
          label={t("email")}
          name="email"
          type="email"
          autoComplete="username"
          required
        />
        <Field
          label={t("password")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
        {methods.magicLink ? (
          <Button
            type="submit"
            variant="outline"
            className="w-full"
            formAction={linkAction}
            disabled={busy}
            data-testid="login-magic-link"
          >
            <Mail aria-hidden="true" />
            {linkPending ? t("magicLinkPending") : t("magicLink")}
          </Button>
        ) : null}
        <p className="text-14">
          <Link href="/forgot-password" className="underline">
            {t("forgotPassword")}
          </Link>
        </p>
      </form>
      {methods.google ? (
        <form action={googleAction} className="space-y-3">
          <p className="text-12 text-text-secondary text-center">{t("or")}</p>
          <input type="hidden" name="next" value={next} />
          <Button
            type="submit"
            variant="outline"
            className="w-full"
            disabled={busy}
            data-testid="login-google"
          >
            <LogIn aria-hidden="true" />
            {googlePending ? t("googlePending") : t("google")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
