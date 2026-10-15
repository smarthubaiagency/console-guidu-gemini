import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { AppShell } from "@/components/layout/shell/app-shell";
import { getConsoleAccess } from "@/core/auth/console-access";
import { loadNotificationBell } from "@/core/notifications/bell";
import { loadPlatformNavigation } from "@/core/module-runtime/loaders";
import { ConsoleHeader } from "@/components/layout/shell/console-header";
import { getRequestBrand } from "@/core/brand/resolve";
import { translateNavigation } from "@/core/i18n/navigation";
import { getModuleCatalog } from "@/core/i18n/modules";
import { getTranslations } from "next-intl/server";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const brand = await getRequestBrand();
  const identity = await requirePlatformAdminPage("/platform");
  const adminInfo = await getPlatformAdminMember(prisma, identity.userId);
  const t = await getTranslations("nav");
  const ts = await getTranslations("shell");
  const catalog = await getModuleCatalog();

  return (
    <AppShell
      access={await getConsoleAccess(identity.userId)}
      bell={await loadNotificationBell(identity.userId)}
      area="platform"
      sections={translateNavigation(
        loadPlatformNavigation(adminInfo?.role ?? null),
        "platform",
        t,
        catalog.entryLabel,
      )}
      header={
        <ConsoleHeader
          href="/platform"
          brandName={brand.name}
          logoUrl={brand.logoUrl}
          logoDarkUrl={brand.logoDarkUrl}
          title={ts("platformTitle", { app: brand.name })}
          subtitle={ts("mfaSession")}
        />
      }
      user={{ email: identity.email, role: adminInfo?.role }}
    >
      {children}
    </AppShell>
  );
}
