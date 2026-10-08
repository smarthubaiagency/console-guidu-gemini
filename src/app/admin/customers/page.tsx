import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listAdminOrganizations } from "@/core/admin/platform";

export const metadata: Metadata = { title: "Clientes & Empresas (Admin)" };

export default async function AdminCustomersPage() {
  const identity = await requirePlatformAdminPage("/admin/customers");
  const organizations = await listAdminOrganizations(prisma, identity.userId);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">
          <span>Administração</span>
          <span>/</span>
          <span>Clientes & Empresas</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-900 text-white">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Empresas Contratantes
            </h1>
            <p className="text-xs text-neutral-500">
              Listagem global das organizações, capacidades contratadas e status operacional.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 bg-neutral-50/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-700">
            Total de Organizações ({organizations.length})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-semibold border-b border-neutral-200">
              <tr>
                <th className="px-5 py-3">Organização</th>
                <th className="px-5 py-3">Assentos Máximos</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {organizations.map((org) => (
                <tr key={org.id} className="hover:bg-neutral-50/50">
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-neutral-900">{org.name}</div>
                    <div className="text-[11px] font-mono text-neutral-400">{org.id}</div>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700 font-medium">
                    {org.maxSeats} assentos
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {org.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-500">
                    {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
                      org.createdAt,
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
