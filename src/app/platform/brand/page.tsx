import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { BrandForm } from "@/components/brand/brand-form";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { BrandMark } from "@/shared/ui/brand-mark";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("brand.platform");
  return { title: t("metaTitle") };
}

/**
 * Brand of the house partner, served on the platform hosts (ADR 0012, P3).
 * Each save creates a new version; without versions the environment brand
 * (APP_NAME) applies.
 */
export default async function PlatformBrandPage() {
  const identity = await requirePlatformAdminPage("/platform/brand");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  if (!platformGrants(admin?.role ?? null)("platform.brand.manage")) {
    return <ModuleNotice variant="denied" />;
  }

  const brand = await getRequestBrand();
  const t = await getTranslations("brand.platform");
  const tPlatform = await getTranslations("platform");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ModulePageHeader
        trail={[tPlatform("breadcrumb"), t("breadcrumb")]}
        title={t("title")}
        description={t("description")}
        icon={<Palette className="h-5 w-5" />}
      />

      <section className="border-card-border bg-surface-card flex items-center gap-3 rounded-xl border p-4 shadow-xs">
        <BrandMark name={brand.name} logoUrl={brand.logoUrl} size="md" />
        <div>
          <div
            className="text-14 text-text font-semibold"
            data-testid="brand-current-name"
          >
            {brand.name}
          </div>
          <div className="text-12 text-text-secondary">
            {brand.source === "partner"
              ? t("version", { version: brand.version ?? "" })
              : t("envBrand")}
          </div>
        </div>
      </section>

      <section className="border-card-border bg-surface-card rounded-xl border p-6 shadow-xs">
        <BrandForm
          defaults={{
            displayName: brand.name,
            primaryColor: brand.primaryColor ?? "",
            supportEmail: brand.supportEmail ?? "",
            supportUrl: brand.supportUrl ?? "",
          }}
          hasLogo={Boolean(brand.logoUrl)}
        />
      </section>
    </div>
  );
}
