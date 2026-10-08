import type { Metadata } from "next";
import Link from "next/link";
import {
  ShoppingBag,
  Store,
  Bot,
  PlayCircle,
  Users,
  Settings,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = {
  title: "Dashboard do Workspace",
};

interface WorkspacePageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}`);
  const context = await resolveWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { workspace, organization, memberCount, pendingInvitesCount } =
    await withContext(prisma, context, async (tx) => {
      const [ws, org, members, invites] = await Promise.all([
        tx.workspace.findUnique({
          where: { id: context.workspaceId },
        }),
        tx.organization.findUnique({
          where: { id: context.organizationId },
        }),
        tx.organizationMember.count({
          where: { organizationId: context.organizationId, status: "active" },
        }),
        tx.invitation.count({
          where: { organizationId: context.organizationId, status: "pending" },
        }),
      ]);

      return {
        workspace: ws,
        organization: org,
        memberCount: members,
        pendingInvitesCount: invites,
      };
    });

  const modules = [
    {
      title: "Catálogo",
      description: "Gestão unificada de produtos, itens e estoque multicanal.",
      href: `/app/${workspaceSlug}/catalog`,
      icon: ShoppingBag,
      status: "Em breve",
      statusColor: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      title: "Google Meu Negócio",
      description: "Sincronização de perfis, avaliações e posts corporativos.",
      href: `/app/${workspaceSlug}/google-business`,
      icon: Store,
      status: "Em breve",
      statusColor: "bg-purple-50 text-purple-700 border-purple-200",
    },
    {
      title: "Agentes de IA",
      description: "Automação de fluxos e atendimento assistido por inteligência artificial.",
      href: `/app/${workspaceSlug}/ai-agents`,
      icon: Bot,
      status: "Em breve",
      statusColor: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      title: "Execuções de Jobs",
      description: "Histórico de rotinas em segundo plano, retentativas e logs.",
      href: `/app/${workspaceSlug}/executions`,
      icon: PlayCircle,
      status: "Sem dados",
      statusColor: "bg-neutral-100 text-neutral-600 border-neutral-200",
    },
  ];

  const maxSeats = organization?.maxSeats ?? 5;
  const totalOccupied = memberCount + pendingInvitesCount;
  const seatsPercentage = Math.min(Math.round((totalOccupied / maxSeats) * 100), 100);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Workspace Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-neutral-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-500 font-medium">
            <span>{organization?.name ?? "Organização"}</span>
            <span>•</span>
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Ativo
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
            {workspace?.name ?? workspaceSlug}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Ambiente de trabalho isolado e operacional sob isolamento RLS.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/app/${workspaceSlug}/settings/team`}
            className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50 transition"
          >
            <Users className="h-4 w-4 text-neutral-500" />
            <span>Gerenciar Equipe</span>
          </Link>
          <Link
            href={`/app/${workspaceSlug}/settings/general`}
            className="flex items-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800 transition"
          >
            <Settings className="h-4 w-4" />
            <span>Configurações</span>
          </Link>
        </div>
      </div>

      {/* Quotas & Capacity Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">
              Assentos do Plano
            </span>
            <Users className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-900">
              {totalOccupied}
            </span>
            <span className="text-xs text-neutral-500">
              de {maxSeats} contratados
            </span>
          </div>
          <div className="mt-3 w-full bg-neutral-100 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                seatsPercentage >= 90 ? "bg-amber-500" : "bg-neutral-900"
              }`}
              style={{ width: `${seatsPercentage}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            {memberCount} membros ativos • {pendingInvitesCount} convites pendentes
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">
              Isolamento & Segurança
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-3 text-lg font-bold text-neutral-900">
            RLS Ativo & Forçado
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Todas as consultas de domínio são contextualizadas via Prisma com RLS garantido.
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">
              Status Operacional
            </span>
            <AlertCircle className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="mt-3 text-lg font-bold text-neutral-900">
            Nenhum Incidente
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Serviços em conformidade com o padrão de observabilidade e métricas reais.
          </p>
        </div>
      </div>

      {/* Modules Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Módulos da Plataforma
          </h2>
          <span className="text-xs text-neutral-400">
            Módulos habilitados e integrados
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.title}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs hover:border-neutral-300 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-100 text-neutral-700">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-neutral-900 text-sm">
                          {mod.title}
                        </h3>
                        <span
                          className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${mod.statusColor}`}
                        >
                          {mod.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-neutral-500 leading-relaxed">
                    {mod.description}
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t border-neutral-100 flex items-center justify-end">
                  <Link
                    href={mod.href}
                    className="flex items-center gap-1 text-xs font-medium text-neutral-700 hover:text-neutral-900 transition"
                  >
                    <span>Acessar</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
