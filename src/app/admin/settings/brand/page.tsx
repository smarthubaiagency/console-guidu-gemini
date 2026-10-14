import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { BrandSettings } from "@/components/brand/brand-settings";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { savePartnerBrandAction } from "@/core/brand/actions";
import { getRequestBrand } from "@/core/brand/resolve";
import { partnerGrants } from "@/core/module-runtime/loaders";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("brand.metaTitle") };
}

/**
 * Admin › Configurações › Marca (ADR 0012, P4a; CF2): brand of the partner
 * served on its domains.
 */
export default async function PartnerBrandSettingsPage() {
  const { membership } = await requirePartnerConsolePage(
    "/admin/settings/brand",
  );
  if (!partnerGrants(membership.role)("partner.brand.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const brand = await getRequestBrand();
  const t = await getTranslations("partnerConsole");

  return (
    <>
      <ModulePageHeader
        title={t("brand.title")}
        description={t("brand.description")}
        icon={<Palette className="h-5 w-5" />}
      />
      <BrandSettings
        brand={brand}
        action={savePartnerBrandAction}
        defaultName={membership.partnerName}
        status={
          brand.source === "partner"
            ? t("brand.version", { version: String(brand.version) })
            : t("brand.noBrand")
        }
      />
    </>
  );
}
