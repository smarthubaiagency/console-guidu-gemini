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
  const identity = await requirePlatformAdminPage("/platform");
  const metrics = await getAdminMetrics(prisma, identity.userId);

  return (
    <div className="mx-auto max-w-6xl space-y-8" data-testid="platform-state">
      {/* Header */}
      <div className="border-border border-b pb-5">
        <div className="text-12 text-warning-text mb-1 flex items-center gap-2 font-semibold tracking-wider uppercase">
          <ShieldCheck className="text-warning-solid h-4 w-4" />
          <span>Controle Interno da Plataforma</span>
        </div>
        <h1 className="text-24 text-text font-bold tracking-tight">
          Visão Geral Operacional
        </h1>
        <p className="text-12 text-text-secondary mt-1">
          Métricas consolidadas de clientes, ambientes e identidades sob
          governança central.
        </p>
      </div>

      {/* Metrics Cards (Real counts, no mock numbers) */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-12 text-text-secondary font-medium">
              Empresas / Clientes Ativos
            </span>
            <Building2 className="text-text-tertiary h-4 w-4" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-30 text-text font-bold">
              {metrics.totalOrganizations}
            </span>
            <span className="text-12 text-text-secondary">organizações</span>
          </div>
          <div className="border-border text-12 mt-4 flex items-center justify-between border-t pt-3">
            <Link
              href="/platform/customers"
              className="text-warning-text hover:text-warning-text flex items-center gap-1 font-semibold"
            >
              <span>Gerenciar empresas</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-12 text-text-secondary font-medium">
              Workspaces Ativos
            </span>
            <Layers className="text-text-tertiary h-4 w-4" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-30 text-text font-bold">
              {metrics.totalWorkspaces}
            </span>
            <span className="text-12 text-text-secondary">
              ambientes isolados
            </span>
          </div>
          <div className="border-border text-12 mt-4 flex items-center justify-between border-t pt-3">
            <Link
              href="/platform/workspaces"
              className="text-warning-text hover:text-warning-text flex items-center gap-1 font-semibold"
            >
              <span>Ver workspaces</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-12 text-text-secondary font-medium">
              Usuários Cadastrados
            </span>
            <Users className="text-text-tertiary h-4 w-4" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-30 text-text font-bold">
              {metrics.totalUsers}
            </span>
            <span className="text-12 text-text-secondary">
              identidades ativas
            </span>
          </div>
          <div className="border-border text-12 mt-4 flex items-center justify-between border-t pt-3">
            <Link
              href="/platform/users"
              className="text-warning-text hover:text-warning-text flex items-center gap-1 font-semibold"
            >
              <span>Listar usuários</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Security & Health Banner */}
      <div className="border-warning-border bg-warning-bg flex flex-col justify-between gap-4 rounded-xl border p-6 md:flex-row md:items-center">
        <div>
          <div className="text-12 text-warning-text flex items-center gap-2 font-bold tracking-wider uppercase">
            <ShieldCheck className="text-warning-solid h-4 w-4" />
            <span>Isolamento e Segurança Operacional</span>
          </div>
          <p className="text-12 text-text-subtle mt-1 max-w-xl leading-relaxed">
            Sessão administrativa autenticada com AAL2 (TOTP verificado).
            Consultas globais de governança usam funções dedicadas
            security-definer auditadas no banco de dados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="bg-success-bg text-12 text-success-text border-success-border inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold">
            <TrendingUp className="h-3.5 w-3.5" />
            Operação Saudável
          </span>
        </div>
      </div>
    </div>
  );
}
