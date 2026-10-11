import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";

import { formatDate, sectionClass } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { displayValue, PROPOSAL_STATUS_LABELS } from "@/core/proposals/labels";
import { listProposals, type ProposalView } from "@/core/proposals/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Propostas" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

function summary(p: ProposalView): string {
  const name = p.payload.name;
  return typeof name === "string" ? name : displayValue(p.targetId);
}

function ProposalList({
  items,
  base,
  testId,
}: Readonly<{ items: ProposalView[]; base: string; testId: string }>) {
  return (
    <ul className="divide-border divide-y" data-testid={testId}>
      {items.map((p) => (
        <li
          key={p.id}
          className="flex flex-wrap items-center justify-between gap-2 py-3"
          data-testid="proposal-row"
        >
          <Link
            href={`${base}/${p.id}`}
            className="text-14 text-text font-medium hover:underline"
          >
            {p.operationLabel}: {summary(p)}
          </Link>
          <span className="text-12 text-text-secondary">
            {PROPOSAL_STATUS_LABELS[p.status]} · pedida em{" "}
            {formatDate(p.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Proposals of the assistants (F4d, §17.4): what waits for a decision and
 * the recent history. Owner and admin only.
 */
export default async function ProposalsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/proposals`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const view = await withContext(prisma, context, async (tx) => {
    const grants = workspaceGrants(
      await getEffectiveWorkspaceRole(tx, context),
    );
    if (!grants("workspace.proposals.review")) return null;
    return listProposals(tx, context, { view: "all", take: 100 });
  });
  if (!view) return <ModuleNotice variant="denied" />;
  const open = view.filter((p) => p.status === "pending");
  const history = view.filter((p) => p.status !== "pending");
  const base = `/app/${workspaceSlug}/proposals`;

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="proposals">
      <ModulePageHeader
        trail={["Plataforma", "Propostas"]}
        title="Propostas"
        description="Escritas pedidas por assistentes conectados pelo MCP. Nada acontece sem a aprovação de uma pessoa."
        icon={<Inbox className="h-5 w-5" />}
      />
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          Aguardando decisão ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="text-12 text-text-secondary">
            Nenhuma proposta esperando.
          </p>
        ) : (
          <ProposalList items={open} base={base} testId="proposals-open" />
        )}
      </section>
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Histórico</h2>
        {history.length === 0 ? (
          <p className="text-12 text-text-secondary">Sem histórico ainda.</p>
        ) : (
          <ProposalList
            items={history}
            base={base}
            testId="proposals-history"
          />
        )}
      </section>
    </div>
  );
}
