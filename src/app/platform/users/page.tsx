import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listAdminUsers } from "@/core/admin/platform";

export const metadata: Metadata = { title: "Usuários (Admin)" };

export default async function AdminUsersPage() {
  const identity = await requirePlatformAdminPage("/platform/users");
  const users = await listAdminUsers(prisma, identity.userId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-warning-text mb-1 flex items-center gap-2 font-semibold tracking-wider uppercase">
          <span>Administração</span>
          <span>/</span>
          <span>Usuários</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-primary text-on-primary rounded-lg p-2">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Usuários da Plataforma
            </h1>
            <p className="text-12 text-text-secondary">
              Perfis de usuários registrados e seus respectivos estados de
              autorização.
            </p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border bg-surface-sidebar flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-12 text-text-subtle font-semibold">
            Total de Usuários ({users.length})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="text-12 w-full text-left">
            <thead className="bg-surface-raised text-text-secondary border-border border-b font-semibold tracking-wider uppercase">
              <tr>
                <th className="px-5 py-3">Nome / Perfil</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Cadastrado em</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-hover">
                  <td className="px-5 py-3.5">
                    <div className="text-text font-semibold">
                      {u.fullName ?? "Sem nome cadastrado"}
                    </div>
                    <div className="text-11 text-text-tertiary font-mono">
                      {u.id}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`text-11 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                        u.status === "active"
                          ? "bg-success-bg text-success-text border-success-border border"
                          : "bg-danger-bg text-danger-text border-danger-border border"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          u.status === "active"
                            ? "bg-success-solid"
                            : "bg-danger-solid"
                        }`}
                      />
                      {u.status}
                    </span>
                  </td>
                  <td className="text-text-secondary px-5 py-3.5">
                    {new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "short",
                    }).format(u.createdAt)}
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
