import type { Metadata } from "next";
import { Layers } from "lucide-react";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listAdminWorkspaces } from "@/core/admin/platform";

export const metadata: Metadata = { title: "Workspaces (Admin)" };

export default async function AdminWorkspacesPage() {
  const identity = await requirePlatformAdminPage("/admin/workspaces");
  const workspaces = await listAdminWorkspaces(prisma, identity.userId);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">
          <span>Administração</span>
          <span>/</span>
          <span>Workspaces</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-900 text-white">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Workspaces da Plataforma
            </h1>
            <p className="text-xs text-neutral-500">
              Ambientes operacionais isolados vinculados a cada organização contratante.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 bg-neutral-50/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-700">
            Total de Workspaces ({workspaces.length})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-semibold border-b border-neutral-200">
              <tr>
                <th className="px-5 py-3">Workspace</th>
                <th className="px-5 py-3">Slug</th>
                <th className="px-5 py-3">Organização</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {workspaces.map((ws) => (
                <tr key={ws.id} className="hover:bg-neutral-50/50">
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-neutral-900">{ws.name}</div>
                    <div className="text-[11px] font-mono text-neutral-400">{ws.id}</div>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-neutral-700">
                    {ws.slug}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-800 font-medium">
                    {ws.organizationName}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {ws.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-500">
                    {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
                      ws.createdAt,
                    )}
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
