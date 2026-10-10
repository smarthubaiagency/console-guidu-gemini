import type { Metadata } from "next";
import { Hand } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { supportStatusLabel } from "@/components/partners/support-status";
import { requireUserPage } from "@/core/auth/page-guard";
import { decideSupportGrantAction } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { listWorkspaceSupportGrants } from "@/core/partners/support";
import { isPermissionDeniedError } from "@/core/permissions/guard";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Acesso de suporte" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * Support access requests of the partner for this company (ADR 0012,
 * P4b2): owners and admins approve, deny or revoke; history stays visible.
 */
export default async function WorkspaceSupportPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/support`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  let grants;
  try {
    grants = await withContext(prisma, context, (tx) =>
      listWorkspaceSupportGrants(tx, context),
    );
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return <ModuleNotice variant="denied" />;
    }
    throw error;
  }

  const decide = (
    grantId: string,
    decision: string,
    label: string,
    primary = false,
  ) => (
    <ActionForm
      action={decideSupportGrantAction}
      submitLabel={label}
      tone={primary ? "primary" : "neutral"}
    >
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="decision" value={decision} />
    </ActionForm>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Configurações", "Acesso de suporte"]}
        title="Acesso de suporte"
        description="Pedidos da equipe do seu parceiro para ver este workspace. A aprovação vale só para este workspace, como visualizador, até o prazo pedido."
        icon={<Hand className="h-5 w-5" />}
      />
      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="workspace-support-grants"
      >
        {grants.map((grant) => (
          <li
            key={grant.id}
            className="flex flex-wrap items-center justify-between gap-4 p-4"
          >
            <div>
              <div className="text-14 text-text font-semibold">
                {grant.granteeEmail}
              </div>
              <div className="text-12 text-text-secondary">
                {supportStatusLabel(grant)} · {grant.durationHours} h · pedido
                em {grant.createdAt.toLocaleString("pt-BR")}
                {grant.workspaceSlug
                  ? ` · workspace ${grant.workspaceSlug}`
                  : ""}
              </div>
              <div className="text-12 text-text-subtle">
                Motivo: {grant.reason}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {grant.status === "pending" ? (
                <>
                  {decide(grant.id, "approve", "Aprovar", true)}
                  {decide(grant.id, "deny", "Negar")}
                </>
              ) : null}
              {grant.active ? decide(grant.id, "revoke", "Revogar") : null}
            </div>
          </li>
        ))}
        {grants.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            Nenhum pedido de acesso de suporte.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
