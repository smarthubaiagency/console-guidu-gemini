import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listAdminUsers } from "@/core/admin/platform";

export const metadata: Metadata = { title: "Usuários (Admin)" };

export default async function AdminUsersPage() {
  const identity = await requirePlatformAdminPage("/admin/users");
  const users = await listAdminUsers(prisma, identity.userId);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">
          <span>Administração</span>
          <span>/</span>
          <span>Usuários</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-900 text-white">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Usuários da Plataforma
            </h1>
            <p className="text-xs text-neutral-500">
              Perfis de usuários registrados e seus respectivos estados de autorização.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 bg-neutral-50/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-700">
            Total de Usuários ({users.length})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-semibold border-b border-neutral-200">
              <tr>
                <th className="px-5 py-3">Nome / Perfil</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Cadastrado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-neutral-50/50">
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-neutral-900">
                      {u.fullName ?? "Sem nome cadastrado"}
                    </div>
                    <div className="text-[11px] font-mono text-neutral-400">{u.id}</div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        u.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          u.status === "active" ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                      {u.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-500">
                    {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
                      u.createdAt,
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
