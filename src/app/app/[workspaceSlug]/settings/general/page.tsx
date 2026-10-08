import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Configurações Gerais" };

interface GeneralPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function GeneralSettingsPage({ params }: GeneralPageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/settings/general`);
  const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);

  const { workspace, organization } = await withContext(prisma, context, async (tx) => {
    const ws = await tx.workspace.findUnique({ where: { id: context.workspaceId } });
    const org = await tx.organization.findUnique({ where: { id: context.organizationId } });
    return { workspace: ws, organization: org };
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>Geral</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Configurações do Workspace
            </h1>
            <p className="text-xs text-neutral-500">
              Identificação do ambiente, organização e parâmetros operacionais.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-xs space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-500">
            Nome do Workspace
          </label>
          <div className="mt-1 text-sm font-semibold text-neutral-900">
            {workspace?.name}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500">
            Slug de Roteamento
          </label>
          <div className="mt-1 text-xs font-mono text-neutral-700 bg-neutral-50 px-2 py-1 rounded inline-block">
            {workspace?.slug}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500">
            Organização Contratante
          </label>
          <div className="mt-1 text-sm font-medium text-neutral-800">
            {organization?.name}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500">
            Identificador UUID
          </label>
          <div className="mt-1 text-xs font-mono text-neutral-500">
            {workspace?.id}
          </div>
        </div>
      </div>
    </div>
  );
}
