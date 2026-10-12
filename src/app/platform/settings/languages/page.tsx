import type { Metadata } from "next";
import Link from "next/link";
import { Languages } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { addLanguageAction, updateLanguageAction } from "@/core/i18n/actions";
import { listLanguages } from "@/core/i18n/service";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const languages = await withIdentityContext(prisma, identity.userId, (tx) =>
    listLanguages(tx, { userId: identity.userId, platformRole: role }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<Languages className="h-5 w-5" />}
      />

      <section className="border-card-border bg-surface-card rounded-xl border shadow-xs">
        <Table className="text-12" data-testid="languages-table">
          <TableHeader className="text-left">
            <TableRow>
              <TableHead className="px-4 font-medium">{t("name")}</TableHead>
              <TableHead className="px-4 font-medium">{t("code")}</TableHead>
              <TableHead className="px-4 font-medium">{t("status")}</TableHead>
              <TableHead className="px-4 font-medium">
                {t("progress")}
              </TableHead>
              <TableHead className="px-4 font-medium">{t("edits")}</TableHead>
              <TableHead className="px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {languages.map((l) => {
              const percent = Math.floor((l.translated / l.total) * 100);
              return (
                <TableRow key={l.code} data-testid={`language-${l.code}`}>
                  <TableCell className="text-text px-4 font-semibold">
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
                  </TableCell>
                  <TableCell className="text-text-secondary px-4 font-mono">
                    {l.code}
                  </TableCell>
                  <TableCell className="px-4">
                    {t(`statuses.${l.status}`)}
                  </TableCell>
                  <TableCell className="px-4">
                    {percent}% ({l.translated}/{l.total})
                  </TableCell>
                  <TableCell className="px-4">{l.edits}</TableCell>
                  <TableCell className="px-4">
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-6 shadow-xs">
        <h2 className="text-14 text-text font-semibold">{t("add")}</h2>
        <p className="text-12 text-text-secondary">{t("addHint")}</p>
        <ActionForm
          action={addLanguageAction}
          submitLabel={t("add")}
          testId="add-language"
        >
          <Label className="flex-col items-start">
            {t("code")}
            <Input name="code" required maxLength={12} placeholder="fr" />
          </Label>
          <Label className="flex-col items-start">
            {t("name")}
            <Input name="name" required maxLength={60} placeholder="Français" />
          </Label>
        </ActionForm>
        <p className="text-11 text-text-secondary">{t("autoTranslate")}</p>
      </section>
    </div>
  );
}
