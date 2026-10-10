import { PlatformHeader } from "@/components/layout/platform-header";
import { PlatformSidebar } from "@/components/layout/platform-sidebar";
import { partnerRoleLabel } from "@/components/partners/role-label";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { buildPartnerNavigation } from "@/core/module-runtime/navigation";

/** Partner console (ADR 0012): host selects the partner, role selects pages. */
export default async function PartnerConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = await getRequestBrand();
  const { identity, membership } = await requirePartnerConsolePage("/admin");

  return (
    <div className="bg-surface-hover text-text flex min-h-screen flex-col">
      <PlatformHeader
        userEmail={identity.email}
        adminRole={partnerRoleLabel(membership.role)}
        appName={brand.name}
        logoUrl={brand.logoUrl}
      />
      <div className="flex flex-1 overflow-hidden">
        <PlatformSidebar
          sections={buildPartnerNavigation(partnerGrants(membership.role))}
          title="Console do parceiro"
          subtitle={membership.partnerName}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
