import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  calendarDateFormatter,
  sectionClass,
} from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { AI_PROVIDER_IDS, getBackupSettings } from "@/core/ai/keys";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { requireAiModule, requirePlatformAiRole } from "../guard";
import { BackupForm } from "./backup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("backup.metaTitle") };
}

/**
 * Backup key of the platform and its cheap model (A3a, especificação §9.2):
 * used only to finish, for up to 24 hours, the open conversations of a
 * GUIDS whose customer key failed. The key appears masked only.
 */
export default async function PlatformAiBackupPage() {
  requireAiModule();
  const identity = await requirePlatformAdminPage("/platform/ai/backup");
  const role = await requirePlatformAiRole(identity.userId);
  const settings = await withIdentityContext(prisma, identity.userId, (tx) =>
    getBackupSettings(tx, role),
  );
  const t = await getTranslations("aiConsole");
  const formatDate = await calendarDateFormatter();

  return (
    <div
      className="mx-auto max-w-4xl space-y-6"
      data-testid="platform-ai-backup"
    >
      <ModulePageHeader
        title={t("backup.title")}
        description={t("backup.description")}
        icon={<LifeBuoy className="h-5 w-5" />}
      />
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          {t("backup.current")}
        </h2>
        <p className="text-12 text-text-secondary" data-testid="backup-current">
          {settings.maskedValue && settings.provider
            ? t("backup.keySet", {
                provider: t(`providers.${settings.provider}`),
                masked: settings.maskedValue,
              })
            : t("backup.noKey")}
          {" · "}
          {settings.model
            ? t("backup.modelSet", { model: settings.model })
            : t("backup.noModel")}
          {settings.updatedAt
            ? ` · ${t("backup.updated", { date: formatDate(new Date(settings.updatedAt)) })}`
            : ""}
        </p>
        {!settings.maskedValue || !settings.model ? (
          <p className="text-12 text-destructive" data-testid="backup-off">
            {t("backup.off")}
          </p>
        ) : null}
      </section>
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("backup.edit")}</h2>
        <BackupForm
          providers={AI_PROVIDER_IDS}
          provider={settings.provider}
          model={settings.model}
          hasKey={Boolean(settings.maskedValue)}
        />
      </section>
    </div>
  );
}
