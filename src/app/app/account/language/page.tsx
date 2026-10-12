import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageStatus } from "@/components/feedback/page-status";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { saveMyLanguageAction } from "@/core/i18n/actions";
import { activeLanguages } from "@/core/i18n/store";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Idioma" };

/** The person's language (I1): wins over the default of each workspace. */
export default async function AccountLanguagePage() {
  const identity = await requireUserPage("/app/account/language");
  const t = await getTranslations("preferences");
  const [languages, profile] = await Promise.all([
    activeLanguages(),
    withIdentityContext(prisma, identity.userId, (tx) =>
      tx.profile.findUnique({
        where: { id: identity.userId },
        select: { locale: true },
      }),
    ),
  ]);

  return (
    <PageStatus>
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <Link href="/app" className="text-12 text-primary">
          ←
        </Link>
        <h1 className="text-30 mt-2 font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-text-secondary text-14 mt-2">
          {identity.email ?? identity.userId}
        </p>
        <section className="border-card-border bg-surface-card mt-8 space-y-3 rounded-xl border p-6 shadow-xs">
          <h2 className="text-14 text-text font-semibold">{t("personal")}</h2>
          <p className="text-12 text-text-secondary">{t("personalHint")}</p>
          <ActionForm
            action={saveMyLanguageAction}
            submitLabel={t("title")}
            testId="my-language"
          >
            <Label className="flex-col items-start">
              {t("personal")}
              <NativeSelect
                name="locale"
                defaultValue={profile?.locale ?? ""}
                className="w-full"
              >
                <NativeSelectOption value="">
                  {t("followWorkspace")}
                </NativeSelectOption>
                {languages.map((l) => (
                  <NativeSelectOption key={l.code} value={l.code}>
                    {l.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          </ActionForm>
        </section>
      </main>
    </PageStatus>
  );
}
