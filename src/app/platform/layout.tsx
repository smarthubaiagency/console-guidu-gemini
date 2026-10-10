import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { PlatformSidebar } from "@/components/layout/platform-sidebar";
import { loadPlatformNavigation } from "@/core/module-runtime/loaders";
import { PlatformHeader } from "@/components/layout/platform-header";
import { getRequestBrand } from "@/core/brand/resolve";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const brand = await getRequestBrand();
  const identity = await requirePlatformAdminPage("/platform");
  const adminInfo = await getPlatformAdminMember(prisma, identity.userId);

  return (
    <div className="bg-surface-hover text-text flex min-h-screen flex-col">
      <PlatformHeader
        userEmail={identity.email}
        adminRole={adminInfo?.role}
        appName={brand.name}
        logoUrl={brand.logoUrl}
      />

      <div className="flex flex-1 overflow-hidden">
        <PlatformSidebar
          sections={loadPlatformNavigation(adminInfo?.role ?? null)}
        />
        <main className="bg-surface-sidebar flex-1 overflow-y-auto p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
