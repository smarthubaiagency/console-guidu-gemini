import type { Metadata } from "next";
import Link from "next/link";
import {
  Building2,
  Layers,
  Users,
  ShieldCheck,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { getAdminMetrics } from "@/core/admin/platform";

export const metadata: Metadata = { title: "Console de Administração" };

export default async function AdminPage() {
  const identity = await requirePlatformAdminPage("/admin");
  const metrics = await getAdminMetrics(prisma, identity.userId);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">
          <ShieldCheck className="h-4 w-4 text-amber-600" />
          <span>Controle Interno da Plataforma</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Visão Geral Operacional
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          Métricas consolidadas de clientes, ambientes e identidades sob governança central.
        </p>
      </div>

      {/* Metrics Cards (Real counts, no mock numbers) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">
              Empresas / Clientes Ativos
            </span>
            <Building2 className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-neutral-900">
              {metrics.totalOrganizations}
            </span>
            <span className="text-xs text-neutral-500">organizações</span>
          </div>
          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
            <Link
              href="/admin/customers"
              className="text-amber-700 hover:text-amber-800 font-semibold flex items-center gap-1"
            >
              <span>Gerenciar empresas</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">
              Workspaces Ativos
            </span>
            <Layers className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-neutral-900">
              {metrics.totalWorkspaces}
            </span>
            <span className="text-xs text-neutral-500">ambientes isolados</span>
          </div>
          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
            <Link
              href="/admin/workspaces"
              className="text-amber-700 hover:text-amber-800 font-semibold flex items-center gap-1"
            >
              <span>Ver workspaces</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">
              Usuários Cadastrados
            </span>
            <Users className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-neutral-900">
              {metrics.totalUsers}
            </span>
            <span className="text-xs text-neutral-500">identidades ativas</span>
          </div>
          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
            <Link
              href="/admin/users"
              className="text-amber-700 hover:text-amber-800 font-semibold flex items-center gap-1"
            >
              <span>Listar usuários</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Security & Health Banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800 uppercase tracking-wider">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            <span>Isolamento e Segurança Operacional</span>
          </div>
          <p className="mt-1 text-xs text-neutral-600 max-w-xl leading-relaxed">
            Sessão administrativa autenticada com AAL2 (TOTP verificado). Consultas globais de governança usam funções dedicadas security-definer auditadas no banco de dados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 border border-emerald-300">
            <TrendingUp className="h-3.5 w-3.5" />
            Operação Saudável
          </span>
        </div>
      </div>
    </div>
  );
}
