import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listAdminWorkspaces } from "@/core/admin/platform";

export const metadata: Metadata = { title: "Workspaces (Admin)" };

export default async function AdminWorkspacesPage() {
  const identity = await requirePlatformAdminPage("/platform/workspaces");
  const workspaces = await listAdminWorkspaces(prisma, identity.userId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-warning-text mb-1 flex items-center gap-2 font-semibold tracking-wider uppercase">
          <span>Administração</span>
          <span>/</span>
          <span>Workspaces</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-primary text-on-primary rounded-lg p-2">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Workspaces da Plataforma
            </h1>
            <p className="text-12 text-text-secondary">
              Ambientes operacionais isolados vinculados a cada organização
              contratante.
            </p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border bg-surface-sidebar flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-12 text-text-subtle font-semibold">
            Total de Workspaces ({workspaces.length})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="text-12 w-full text-left">
            <thead className="bg-surface-raised text-text-secondary border-border border-b font-semibold tracking-wider uppercase">
              <tr>
                <th className="px-5 py-3">Workspace</th>
                <th className="px-5 py-3">Slug</th>
                <th className="px-5 py-3">Organização</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {workspaces.map((ws) => (
                <tr key={ws.id} className="hover:bg-surface-hover">
                  <td className="px-5 py-3.5">
                    <div className="text-text font-semibold">{ws.name}</div>
                    <div className="text-11 text-text-tertiary font-mono">
                      {ws.id}
                    </div>
                  </td>
                  <td className="text-text-subtle px-5 py-3.5 font-mono">
                    {ws.slug}
                  </td>
                  <td className="text-text px-5 py-3.5 font-medium">
                    {ws.organizationName}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="bg-success-bg text-success-text border-success-border text-11 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium">
                      <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                      {ws.status}
                    </span>
                  </td>
                  <td className="text-text-secondary px-5 py-3.5">
                    {new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "short",
                    }).format(ws.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
