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
    <div className="min-h-screen flex flex-col bg-neutral-100 text-neutral-900">
      <AdminHeader
        userEmail={identity.email}
        adminRole={adminInfo?.role}
      />

      <div className="flex-1 flex overflow-hidden">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto bg-neutral-50/50 p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
