import type { Metadata } from "next";
import { Puzzle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { setModuleOfferedAction } from "@/core/partners/actions";
import {
  listOfferableModules,
  listOfferedModuleKeys,
} from "@/core/partners/customers";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("modules.metaTitle") };
}

const RELEASE_KEYS = new Set(["beta", "available", "maintenance"]);

/** Module catalog the partner offers to its customers (ADR 0012, P4b). */
export default async function PartnerModulesPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/modules");
  if (!partnerGrants(membership.role)("partner.customers.manage")) {
    return <ModuleNotice variant="denied" />;
  }

  const offered = new Set(
    await withIdentityContext(
      prisma,
      identity.userId,
      (tx) => listOfferedModuleKeys(tx, partner.partnerId),
      { partnerId: partner.partnerId },
    ),
  );
  const modules = listOfferableModules();

  const t = await getTranslations("partnerConsole");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={[t("breadcrumb"), t("modules.title")]}
        title={t("modules.title")}
        description={t("modules.description")}
        icon={<Puzzle className="h-5 w-5" />}
      />
      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="partner-modules"
      >
        {modules.map((mod) => {
          const isOffered = offered.has(mod.moduleKey);
          return (
            <li
              key={mod.moduleKey}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div>
                <div className="text-14 text-text font-semibold">
                  {mod.displayName}
                </div>
                <div className="text-12 text-text-secondary">
                  {RELEASE_KEYS.has(mod.releaseStatus)
                    ? t(`modules.release.${mod.releaseStatus}`)
                    : mod.releaseStatus}{" "}
                  · {isOffered ? t("modules.offered") : t("modules.notOffered")}
                </div>
              </div>
              <ActionForm
                action={setModuleOfferedAction}
                submitLabel={
                  isOffered ? t("modules.withdraw") : t("modules.offer")
                }
                tone={isOffered ? "neutral" : "primary"}
              >
                <input type="hidden" name="moduleKey" value={mod.moduleKey} />
                <input
                  type="hidden"
                  name="offered"
                  value={isOffered ? "false" : "true"}
                />
              </ActionForm>
            </li>
          );
        })}
        {modules.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            {t("modules.empty")}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
