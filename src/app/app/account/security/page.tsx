import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageStatus } from "@/components/feedback/page-status";
import { requireUserPage } from "@/core/auth/page-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";

import { unenrolTotpFactor } from "./actions";
import { TotpEnrolment } from "./totp-enrolment";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("security.metadataTitle") };
}

export default async function AccountSecurityPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  // Server-side guard. The middleware only avoids showing this shell to
  // signed-out visitors; the decision is made here.
  const identity = await requireUserPage("/app/account/security");

  const t = await getTranslations("account.security");
  const params = await searchParams;
  const mfaRequired = params.reason === "mfa-required";

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified =
    data?.totp.filter((factor) => factor.status === "verified") ?? [];

  return (
    <PageStatus>
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-30 font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-text-secondary text-14 mt-2">
              {identity.email ?? identity.userId}
            </p>
          </div>
          <SignOutForm />
        </header>

        {mfaRequired ? (
          <div className="mt-6">
            <ErrorNotice testId="mfa-required-state">
              {t("mfaRequired")}
            </ErrorNotice>
          </div>
        ) : null}

        <section className="mt-10">
          <h2 className="text-18 font-medium">{t("mfaTitle")}</h2>
          <p className="text-text-secondary text-14 mt-2">
            {t("mfaDescription")}
          </p>

          <div className="mt-6">
            {verified.length > 0 ? (
              <ul className="space-y-3" data-testid="mfa-factors">
                {verified.map((factor) => (
                  <li
                    key={factor.id}
                    className="border-border-strong text-14 flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <span>{factor.friendly_name ?? t("authenticatorApp")}</span>
                    <form action={unenrolTotpFactor}>
                      <input type="hidden" name="factorId" value={factor.id} />
                      <button type="submit" className="underline">
                        {t("remove")}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <TotpEnrolment />
            )}
          </div>
        </section>
      </main>
    </PageStatus>
  );
}
