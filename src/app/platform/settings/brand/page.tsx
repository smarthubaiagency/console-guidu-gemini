import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { BrandSettings } from "@/components/brand/brand-settings";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("brand.platform");
  return { title: t("metaTitle") };
}

/**
 * Plataforma › Configurações › Marca (ADR 0012, P3; CF2): brand of the
 * house partner, served on the platform hosts. Each save creates a new
 * version; without versions the environment brand (APP_NAME) applies.
 */
export default async function PlatformBrandSettingsPage() {
  const identity = await requirePlatformAdminPage("/platform/settings/brand");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  if (!platformGrants(admin?.role ?? null)("platform.brand.manage")) {
    return <ModuleNotice variant="denied" />;
  }

  const brand = await getRequestBrand();
  const t = await getTranslations("brand.platform");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<Palette className="h-5 w-5" />}
      />
      <BrandSettings
        brand={brand}
        defaultName={brand.name}
        status={
          brand.source === "partner"
            ? t("version", { version: brand.version ?? "" })
            : t("envBrand")
        }
      />
    </>
  );
}
