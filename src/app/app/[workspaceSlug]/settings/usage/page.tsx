import type { Metadata } from "next";
import { Gauge, CheckCircle2 } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Consumo & Limites" };

interface UsagePageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function UsagePage({ params }: UsagePageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/usage`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { organization, memberCount } = await withContext(
    prisma,
    context,
    async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: context.organizationId },
      });
      const count = await tx.organizationMember.count({
        where: { organizationId: context.organizationId, status: "active" },
      });
      return { organization: org, memberCount: count };
    },
  );

  const maxSeats = organization?.maxSeats ?? 5;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>Consumo & Limites</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Consumo, Cotas e Capacidade
            </h1>
            <p className="text-12 text-text-secondary">
              Métricas reais de consumo contratual da organização e do
              workspace.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="text-12 text-text-tertiary font-semibold tracking-wider uppercase">
            Membros & Assentos
          </div>
          <div className="text-24 text-text mt-2 font-bold">
            {memberCount} / {maxSeats}
          </div>
          <p className="text-12 text-text-secondary mt-1">
            Assentos da organização utilizados por usuários ativos.
          </p>
        </div>

        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="text-12 text-text-tertiary font-semibold tracking-wider uppercase">
            Cotas de Execução IA
          </div>
          <div className="text-24 text-text mt-2 flex items-center gap-2 font-bold">
            <span>BYOK</span>
            <CheckCircle2 className="text-success-solid h-4 w-4" />
          </div>
          <p className="text-12 text-text-secondary mt-1">
            Consumo faturado diretamente no provedor do cliente através de chave
            própria.
          </p>
        </div>
      </div>
    </div>
  );
}
