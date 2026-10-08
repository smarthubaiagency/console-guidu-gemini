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

export default async function GeneralSettingsPage({
  params,
}: GeneralPageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/general`,
  );
  const context = await resolveWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { workspace, organization } = await withContext(
    prisma,
    context,
    async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id: context.workspaceId },
      });
      const org = await tx.organization.findUnique({
        where: { id: context.organizationId },
      });
      return { workspace: ws, organization: org };
    },
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>Geral</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Configurações do Workspace
            </h1>
            <p className="text-12 text-text-secondary">
              Identificação do ambiente, organização e parâmetros operacionais.
            </p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card space-y-4 rounded-xl border p-6 shadow-xs">
        <div>
          <label className="text-12 text-text-secondary block font-medium">
            Nome do Workspace
          </label>
          <div className="text-14 text-text mt-1 font-semibold">
            {workspace?.name}
          </div>
        </div>

        <div>
          <label className="text-12 text-text-secondary block font-medium">
            Slug de Roteamento
          </label>
          <div className="text-12 text-text-subtle bg-surface-raised mt-1 inline-block rounded-sm px-2 py-1 font-mono">
            {workspace?.slug}
          </div>
        </div>

        <div>
          <label className="text-12 text-text-secondary block font-medium">
            Organização Contratante
          </label>
          <div className="text-14 text-text mt-1 font-medium">
            {organization?.name}
          </div>
        </div>

        <div>
          <label className="text-12 text-text-secondary block font-medium">
            Identificador UUID
          </label>
          <div className="text-12 text-text-secondary mt-1 font-mono">
            {workspace?.id}
          </div>
        </div>
      </div>
    </div>
  );
}
