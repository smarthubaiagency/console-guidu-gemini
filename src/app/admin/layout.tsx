import { AppShell } from "@/components/layout/shell/app-shell";
import { ConsoleHeader } from "@/components/layout/shell/console-header";
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
    <AppShell
      area="admin"
      sections={translateNavigation(
        buildPartnerNavigation(partnerGrants(membership.role)),
        "partner",
        t,
      )}
      header={
        <ConsoleHeader
          href="/admin"
          brandName={brand.name}
          logoUrl={brand.logoUrl}
          title={brand.name}
          subtitle={`${tc("consoleTitle")} · ${membership.partnerName}`}
        />
      }
      user={{
        email: identity.email,
        role: roleKey ? tAll(roleKey) : membership.role,
      }}
    >
      {children}
    </AppShell>
  );
}
