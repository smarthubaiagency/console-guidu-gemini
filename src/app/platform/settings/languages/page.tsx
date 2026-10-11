import type { Metadata } from "next";
import Link from "next/link";
import { Languages } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { addLanguageAction, updateLanguageAction } from "@/core/i18n/actions";
import { listLanguages } from "@/core/i18n/service";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Idiomas (Admin)" };

/**
 * Plataforma › Configurações › Idiomas (I1): the languages of the dashboard,
 * how much of each is translated, and the way to add one.
 */
export default async function PlatformLanguagesPage() {
  const identity = await requirePlatformAdminPage(
    "/platform/settings/languages",
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.languages.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const t = await getTranslations("languages");
  const tNav = await getTranslations("nav");
  const languages = await withIdentityContext(prisma, identity.userId, (tx) =>
    listLanguages(tx, { userId: identity.userId, platformRole: role }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={[tNav("sections.platform.platform_settings"), t("title")]}
        title={t("title")}
        description={t("description")}
        icon={<Languages className="h-5 w-5" />}
      />

      <section className="border-card-border bg-surface-card rounded-xl border shadow-xs">
        <table className="text-12 w-full" data-testid="languages-table">
          <thead className="text-text-secondary border-border border-b text-left">
            <tr>
              <th className="px-4 py-2 font-medium">{t("name")}</th>
              <th className="px-4 py-2 font-medium">{t("code")}</th>
              <th className="px-4 py-2 font-medium">{t("status")}</th>
              <th className="px-4 py-2 font-medium">{t("progress")}</th>
              <th className="px-4 py-2 font-medium">{t("edits")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {languages.map((l) => {
              const percent = Math.floor((l.translated / l.total) * 100);
              return (
                <tr key={l.code} data-testid={`language-${l.code}`}>
                  <td className="text-text px-4 py-3 font-semibold">
                    {l.name}
                    {l.isDefault ? (
                      <span className="text-10 bg-surface-strong text-text-subtle ml-2 rounded-sm px-1.5 py-0.5">
                        {t("default")}
                      </span>
                    ) : null}
                    {l.isSource ? (
                      <span className="text-10 bg-surface-strong text-text-subtle ml-2 rounded-sm px-1.5 py-0.5">
                        {t("source")}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-text-secondary px-4 py-3 font-mono">
                    {l.code}
                  </td>
                  <td className="px-4 py-3">{t(`statuses.${l.status}`)}</td>
                  <td className="px-4 py-3">
                    {percent}% ({l.translated}/{l.total})
                  </td>
                  <td className="px-4 py-3">{l.edits}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Link
                        href={`/platform/settings/languages/${l.code}`}
                        className="text-12 text-primary font-semibold hover:underline"
                      >
                        {t("edit")}
                      </Link>
                      {!l.isSource && !l.isDefault ? (
                        <ActionForm
                          action={updateLanguageAction}
                          submitLabel={
                            l.status === "active"
                              ? t("deactivate")
                              : t("activate")
                          }
                          tone="neutral"
                        >
                          <input type="hidden" name="code" value={l.code} />
                          <input
                            type="hidden"
                            name="op"
                            value={
                              l.status === "active" ? "deactivate" : "activate"
                            }
                          />
                        </ActionForm>
                      ) : null}
                      {l.status === "active" && !l.isDefault ? (
                        <ActionForm
                          action={updateLanguageAction}
                          submitLabel={t("makeDefault")}
                          tone="neutral"
                        >
                          <input type="hidden" name="code" value={l.code} />
                          <input type="hidden" name="op" value="default" />
                        </ActionForm>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-6 shadow-xs">
        <h2 className="text-14 text-text font-semibold">{t("add")}</h2>
        <p className="text-12 text-text-secondary">{t("addHint")}</p>
        <ActionForm
          action={addLanguageAction}
          submitLabel={t("add")}
          testId="add-language"
        >
          <label className={labelClass}>
            {t("code")}
            <input
              name="code"
              required
              maxLength={12}
              placeholder="fr"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("name")}
            <input
              name="name"
              required
              maxLength={60}
              placeholder="Français"
              className={inputClass}
            />
          </label>
        </ActionForm>
        <p className="text-11 text-text-secondary">{t("autoTranslate")}</p>
      </section>
    </div>
  );
}
