import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { getRequestBrand } from "@/core/brand/resolve";
import { maintenanceStatus } from "@/core/maintenance/runtime";
import {
  activeMode,
  MAINTENANCE_TIME_ZONE,
  maintenanceMessage,
} from "@/core/maintenance/state";
import { AuthShell, SuccessNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("maintenance.page");
  return { title: t("metaTitle") };
}

/**
 * Page of the maintenance window (CF5c): /app, /admin and the invitations
 * send everybody here while the platform is in full maintenance. It shows
 * the admin's message in the person's language and when the platform comes
 * back. Public on purpose: it says nothing but that the platform is closed.
 * Once the window is over it says so, with the way back.
 */
export default async function MaintenancePage() {
  const brand = await getRequestBrand();
  const status = await maintenanceStatus();
  const t = await getTranslations("maintenance.page");
  const back = (
    <div className="flex items-center gap-4">
      <Link href="/app" className="underline" data-testid="maintenance-back">
        {t("back")}
      </Link>
      <SignOutForm />
    </div>
  );

  if (status.phase !== "active" || activeMode(status) !== "maintenance") {
    return (
      <AuthShell
        title={t("overTitle")}
        description={t("overDescription")}
        brand={brand}
        footer={back}
      >
        <SuccessNotice testId="maintenance-over">{t("over")}</SuccessNotice>
      </AuthShell>
    );
  }

  const format = await getFormatter();
  const message = maintenanceMessage(status.window.messages, await getLocale());
  const end = status.window.endsAt;
  return (
    <AuthShell
      title={t("title")}
      description={t("description")}
      brand={brand}
      footer={back}
    >
      <div
        role="status"
        data-testid="maintenance-page"
        className="border-warning-border bg-warning-bg text-14 text-warning-text space-y-2 rounded-md border px-3 py-2"
      >
        {message ? <p data-testid="maintenance-message">{message}</p> : null}
        <p>
          {end
            ? t("until", {
                end: format.dateTime(end, {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: MAINTENANCE_TIME_ZONE,
                }),
              })
            : t("noEnd")}
        </p>
      </div>
    </AuthShell>
  );
}
