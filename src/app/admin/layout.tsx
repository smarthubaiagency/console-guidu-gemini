import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminHeader } from "@/components/layout/admin-header";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const identity = await requirePlatformAdminPage("/admin");
  const adminInfo = await getPlatformAdminMember(prisma, identity.userId);

  return (
    <div className="bg-surface-hover text-text flex min-h-screen flex-col">
      <AdminHeader userEmail={identity.email} adminRole={adminInfo?.role} />

      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar />
        <main className="bg-surface-sidebar flex-1 overflow-y-auto p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
