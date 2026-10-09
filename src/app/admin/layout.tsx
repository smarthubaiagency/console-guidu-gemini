import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { loadAdminNavigation } from "@/core/module-runtime/loaders";
import { AdminHeader } from "@/components/layout/admin-header";
import { appConfig } from "@/core/config/app";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const identity = await requirePlatformAdminPage("/admin");
  const adminInfo = await getPlatformAdminMember(prisma, identity.userId);

  return (
    <div className="bg-surface-hover text-text flex min-h-screen flex-col">
      <AdminHeader
        userEmail={identity.email}
        adminRole={adminInfo?.role}
        appName={appConfig.name}
      />

      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar sections={loadAdminNavigation(adminInfo?.role ?? null)} />
        <main className="bg-surface-sidebar flex-1 overflow-y-auto p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
