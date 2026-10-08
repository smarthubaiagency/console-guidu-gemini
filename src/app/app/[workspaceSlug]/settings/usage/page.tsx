import type { Metadata } from "next";
import { Gauge, CheckCircle2 } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Consumo & Limites" };

interface UsagePageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function UsagePage({ params }: UsagePageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/settings/usage`);
  const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

  const { organization, memberCount } = await withContext(prisma, context, async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: context.organizationId } });
    const count = await tx.organizationMember.count({
      where: { organizationId: context.organizationId, status: "active" },
    });
    return { organization: org, memberCount: count };
  });

  const maxSeats = organization?.maxSeats ?? 5;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>Consumo & Limites</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Consumo, Cotas e Capacidade
            </h1>
            <p className="text-xs text-neutral-500">
              Métricas reais de consumo contratual da organização e do workspace.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Membros & Assentos
          </div>
          <div className="mt-2 text-2xl font-bold text-neutral-900">
            {memberCount} / {maxSeats}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Assentos da organização utilizados por usuários ativos.
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Cotas de Execução IA
          </div>
          <div className="mt-2 text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <span>BYOK</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Consumo faturado diretamente no provedor do cliente através de chave própria.
          </p>
        </div>
      </div>
    </div>
  );
}
