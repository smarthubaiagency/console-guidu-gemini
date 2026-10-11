import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";

import { formatDate, sectionClass } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import {
  approveProposalAction,
  rejectProposalAction,
} from "@/core/proposals/actions";
import {
  displayValue,
  PROPOSAL_ERROR_LABELS,
  PROPOSAL_STATUS_LABELS,
} from "@/core/proposals/labels";
import { getProposal, loadProposalTarget } from "@/core/proposals/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Proposta" };

interface PageProps {
  params: Promise<{ workspaceSlug: string; proposalId: string }>;
}

/**
 * One proposal (F4d): what the assistant asked, the current values of the
 * record and the decision. The approval carries the hash of the content
 * shown here; any difference refuses it.
 */
export default async function ProposalPage({ params }: PageProps) {
  const { workspaceSlug, proposalId } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/proposals/${proposalId}`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const view = await withContext(prisma, context, async (tx) => {
    const grants = workspaceGrants(
      await getEffectiveWorkspaceRole(tx, context),
    );
    if (!grants("workspace.proposals.review"))
      return { kind: "denied" as const };
    try {
      const proposal = await getProposal(tx, context, proposalId);
      const target = await loadProposalTarget(tx, context, proposal);
      return { kind: "ok" as const, proposal, ...target };
    } catch {
      return { kind: "missing" as const };
    }
  });
  if (view.kind === "denied") return <ModuleNotice variant="denied" />;
  if (view.kind === "missing") notFound();
  const { proposal, operation, current, currentVersion } = view;
  const base = `/app/${workspaceSlug}`;
  const fields =
    operation?.fields ??
    Object.keys(proposal.payload).map((key) => ({ key, label: key }));
  const shown = fields.filter((f) => f.key in proposal.payload);
  const changed =
    proposal.targetId !== null &&
    currentVersion !== null &&
    currentVersion !== proposal.resourceVersion;
  const decidable = proposal.status === "pending";

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="proposal">
      <ModulePageHeader
        trail={["Plataforma", "Propostas", operation?.label ?? "Proposta"]}
        title={operation?.label ?? proposal.operation}
        description="Pedida por um assistente com chave de API. Confira o conteúdo antes de decidir."
        icon={<Inbox className="h-5 w-5" />}
      />

      <section className={sectionClass}>
        <p className="text-12 text-text-secondary">
          <span
            className="text-text font-semibold"
            data-testid="proposal-status"
          >
            {PROPOSAL_STATUS_LABELS[proposal.status]}
          </span>{" "}
          · pedida em {formatDate(proposal.createdAt)}
          {proposal.requestedByMe ? " por uma chave sua" : ""} · vence em{" "}
          {proposal.expiresAt.toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            dateStyle: "short",
            timeStyle: "short",
          })}
        </p>
        {proposal.reason ? (
          <p className="text-12 text-text">
            <span className="font-semibold">Motivo informado:</span>{" "}
            {proposal.reason}
          </p>
        ) : null}
        <table className="text-12 w-full" data-testid="proposal-fields">
          <thead>
            <tr className="text-text-secondary text-left">
              <th className="py-2 pr-3 font-medium">Campo</th>
              {proposal.targetId ? (
                <th className="py-2 pr-3 font-medium">Atual</th>
              ) : null}
              <th className="py-2 font-medium">Proposto</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {shown.map((f) => (
              <tr key={f.key}>
                <td className="text-text-secondary py-2 pr-3">{f.label}</td>
                {proposal.targetId ? (
                  <td className="text-text-secondary py-2 pr-3">
                    {displayValue(current?.[f.key])}
                  </td>
                ) : null}
                <td className="text-text py-2 font-medium">
                  {displayValue(proposal.payload[f.key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-11 text-text-secondary">
          Impressão do conteúdo:{" "}
          <code data-testid="proposal-hash">
            {proposal.payloadHash.slice(0, 16)}
          </code>
        </p>
        {proposal.status === "executed" && proposal.resourceId && operation ? (
          <Link
            href={`${base}/${operation.resourcePath(proposal.resourceId)}`}
            className="text-12 text-primary font-semibold"
          >
            Ver o registro
          </Link>
        ) : null}
        {proposal.status === "failed" ? (
          <p className="text-12 text-danger-text" data-testid="proposal-error">
            Não executada:{" "}
            {PROPOSAL_ERROR_LABELS[proposal.errorCode ?? ""] ??
              proposal.errorCode}
            .
          </p>
        ) : null}
        {proposal.status === "approved" ? (
          <p className="text-12 text-text-secondary">
            A execução roda em segundo plano; acompanhe em{" "}
            <Link href={`${base}/executions`} className="underline">
              Execuções
            </Link>
            .
          </p>
        ) : null}
      </section>

      {decidable ? (
        <section className={sectionClass} data-testid="proposal-decision">
          {changed ? (
            <p className="text-12 bg-warning-bg text-warning-text border-warning-border rounded-lg border p-3">
              O registro mudou depois da proposta; ela não pode ser aprovada.
              Rejeite e peça ao assistente uma nova.
            </p>
          ) : null}
          {!identity.mfaSatisfied ? (
            <p className="text-12 bg-warning-bg text-warning-text border-warning-border rounded-lg border p-3">
              Aprovar pede a verificação em duas etapas nesta sessão. Ative ou
              confirme em Segurança da conta.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <ActionForm
              action={approveProposalAction}
              submitLabel="Aprovar e executar"
              testId="approve-proposal"
            >
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input
                type="hidden"
                name="payloadHash"
                value={proposal.payloadHash}
              />
            </ActionForm>
            <ActionForm
              action={rejectProposalAction}
              submitLabel="Rejeitar"
              tone="neutral"
              testId="reject-proposal"
            >
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <input type="hidden" name="proposalId" value={proposal.id} />
            </ActionForm>
          </div>
        </section>
      ) : null}
    </div>
  );
}
