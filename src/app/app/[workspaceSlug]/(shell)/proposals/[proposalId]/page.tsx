import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { sectionClass } from "@/components/billing/billing-ui";
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
import { displayValue } from "@/core/proposals/labels";
import { getProposal, loadProposalTarget } from "@/core/proposals/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

export async function generateMetadata() {
  const t = await getTranslations("proposals");
  return { title: t("metaTitleOne") };
}

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
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(context);
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
  const t = await getTranslations("proposals");
  const format = await getFormatter();
  const base = `/app/${workspaceSlug}`;
  const opKey = `operations.${proposal.operation.replaceAll(".", "_")}`;
  const operationLabel = operation
    ? t.has(`${opKey}.label`)
      ? t(`${opKey}.label`)
      : operation.label
    : null;
  const fields =
    operation?.fields.map((f) => ({
      key: f.key,
      label: t.has(`${opKey}.fields.${f.key}`)
        ? t(`${opKey}.fields.${f.key}`)
        : f.label,
    })) ?? Object.keys(proposal.payload).map((key) => ({ key, label: key }));
  const errorReasonKey = `errorReasons.${proposal.errorCode ?? ""}`;
  const errorReason =
    proposal.errorCode && t.has(errorReasonKey)
      ? t(errorReasonKey)
      : proposal.errorCode;
  const shown = fields.filter((f) => f.key in proposal.payload);
  const changed =
    proposal.targetId !== null &&
    currentVersion !== null &&
    currentVersion !== proposal.resourceVersion;
  const decidable = proposal.status === "pending";

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="proposal">
      <ModulePageHeader
        title={operationLabel ?? proposal.operation}
        description={t("detail.description")}
        icon={<Inbox className="h-5 w-5" />}
      />

      <section className={sectionClass}>
        <p className="text-12 text-text-secondary">
          <span
            className="text-text font-semibold"
            data-testid="proposal-status"
          >
            {t(`status.${proposal.status}`)}
          </span>{" "}
          {t("detail.meta", {
            createdAt: format.dateTime(proposal.createdAt, {
              dateStyle: "short",
              timeZone: "UTC",
            }),
            byMe: proposal.requestedByMe ? "yes" : "no",
            expiresAt: format.dateTime(proposal.expiresAt, {
              timeZone: "America/Sao_Paulo",
              dateStyle: "short",
              timeStyle: "short",
            }),
          })}
        </p>
        {proposal.reason ? (
          <p className="text-12 text-text">
            <span className="font-semibold">{t("detail.reason")}</span>{" "}
            {proposal.reason}
          </p>
        ) : null}
        <Table className="text-12" data-testid="proposal-fields">
          <TableHeader>
            <TableRow className="text-text-secondary text-left">
              <TableHead className="pr-3 font-medium">
                {t("detail.field")}
              </TableHead>
              {proposal.targetId ? (
                <TableHead className="pr-3 font-medium">
                  {t("detail.current")}
                </TableHead>
              ) : null}
              <TableHead className="font-medium">
                {t("detail.proposed")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((f) => (
              <TableRow key={f.key}>
                <TableCell className="text-text-secondary pr-3">
                  {f.label}
                </TableCell>
                {proposal.targetId ? (
                  <TableCell className="text-text-secondary pr-3">
                    {displayValue(current?.[f.key])}
                  </TableCell>
                ) : null}
                <TableCell className="text-text font-medium">
                  {displayValue(proposal.payload[f.key])}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-11 text-text-secondary">
          {t("detail.hash")}{" "}
          <code data-testid="proposal-hash">
            {proposal.payloadHash.slice(0, 16)}
          </code>
        </p>
        {proposal.status === "executed" && proposal.resourceId && operation ? (
          <Link
            href={`${base}/${operation.resourcePath(proposal.resourceId)}`}
            className="text-12 text-primary font-semibold"
          >
            {t("detail.viewRecord")}
          </Link>
        ) : null}
        {proposal.status === "failed" ? (
          <p className="text-12 text-danger-text" data-testid="proposal-error">
            {t("detail.notExecuted", { reason: errorReason ?? "" })}
          </p>
        ) : null}
        {proposal.status === "approved" ? (
          <p className="text-12 text-text-secondary">
            {t.rich("detail.runsInBackground", {
              link: (chunks) => (
                <Link href={`${base}/executions`} className="underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : null}
      </section>

      {decidable ? (
        <section className={sectionClass} data-testid="proposal-decision">
          {changed ? (
            <p className="text-12 bg-warning-bg text-warning-text border-warning-border rounded-lg border p-3">
              {t("detail.recordChanged")}
            </p>
          ) : null}
          {!identity.mfaSatisfied ? (
            <p className="text-12 bg-warning-bg text-warning-text border-warning-border rounded-lg border p-3">
              {t("detail.mfaNeeded")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <ActionForm
              action={approveProposalAction}
              submitLabel={t("detail.approve")}
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
              submitLabel={t("detail.reject")}
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
