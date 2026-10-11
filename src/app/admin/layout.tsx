import { PlatformHeader } from "@/components/layout/platform-header";
import { PlatformSidebar } from "@/components/layout/platform-sidebar";
import { partnerRoleKey } from "@/components/partners/role-label";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { buildPartnerNavigation } from "@/core/module-runtime/navigation";
import { translateNavigation } from "@/core/i18n/navigation";
import { getTranslations } from "next-intl/server";

/** Partner console (ADR 0012): host selects the partner, role selects pages. */
export default async function PartnerConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = await getRequestBrand();
  const { identity, membership } = await requirePartnerConsolePage("/admin");
  const t = await getTranslations("nav");
  const tc = await getTranslations("partnerConsole");
  const tAll = await getTranslations();
  const roleKey = partnerRoleKey(membership.role);

  return (
    <div className="bg-surface-hover text-text flex min-h-screen flex-col">
      <PlatformHeader
        userEmail={identity.email}
        adminRole={roleKey ? tAll(roleKey) : membership.role}
        appName={brand.name}
        logoUrl={brand.logoUrl}
      />
      <div className="flex flex-1 overflow-hidden">
        <PlatformSidebar
          sections={translateNavigation(
            buildPartnerNavigation(partnerGrants(membership.role)),
            "partner",
            t,
          )}
          title={tc("consoleTitle")}
          subtitle={membership.partnerName}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
