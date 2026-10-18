import Link from "next/link";
import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { RecordWorkbench } from "@/components/layout/workbench";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ActionForm } from "@/components/partners/action-form";
import { KeyValueList } from "@/components/patterns/key-value-list";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import {
  approvePartnerProposalAction,
  rejectPartnerProposalAction,
} from "@/core/proposals/admin-actions";
import { displayValue } from "@/core/proposals/labels";
import {
  listPartnerProposals,
  type PartnerProposalRow,
  partnerProposalContext,
} from "@/core/proposals/partner";
import {
  getProposal,
  loadProposalTarget,
  type ProposalStatus,
} from "@/core/proposals/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals.admin");
  return { title: t("metaTitle") };
}

const BASE = "/admin/proposals";

const STATUS_BADGE: Record<
  ProposalStatus,
  "success" | "danger" | "warning" | "neutral" | "info"
> = {
  pending: "warning",
  approved: "info",
  rejected: "neutral",
  executed: "success",
  failed: "danger",
  expired: "neutral",
};

type SearchParams = Partial<Record<"proposal", string>>;

/**
 * Admin › Propostas (H4, ADR 0020): the proposals of the companies the
 * partner manages, where its owner, admin and support decide (the managed
 * customer only follows). The drawer shows what will be done, the content
 * fingerprint the approval is bound to, and the decision; the session is
 * at AAL2 in the console and the service checks everything again.
 */
export default async function PartnerProposalsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const { identity, partner, membership } =
    await requirePartnerConsolePage(BASE);
  const grants = partnerGrants(membership.role);
  if (!grants("partner.proposals.review")) {
    return <ModuleNotice variant="denied" />;
  }
  const actor = {
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership.role,
  };
  const query = await searchParams;
  const editKey = query.proposal || null;
  const rows = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => listPartnerProposals(tx, actor),
    { partnerId: partner.partnerId },
  );
  const selected = editKey
    ? (rows.find((row) => row.id === editKey) ?? null)
    : null;
  const detail = selected
    ? await partnerProposalContext(prisma, actor, selected.id)
        .then((ctx) =>
          withContext(prisma, ctx, async (tx) => {
            const proposal = await getProposal(tx, ctx, selected.id);
            return {
              proposal,
              ...(await loadProposalTarget(tx, ctx, proposal)),
            };
          }),
        )
        .catch(() => null)
    : null;

  const t = await getTranslations("proposals");
  const ta = await getTranslations("proposals.admin");
  const format = await getFormatter();
  const when = (date: Date) =>
    format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    });
  const operationLabel = (operation: string, fallback: string) => {
    const key = `operations.${operation.replaceAll(".", "_")}.label`;
    return t.has(key) ? t(key) : fallback;
  };
  const open = rows.filter((row) => row.status === "pending");
  const history = rows.filter((row) => row.status !== "pending");

  const list = (items: readonly PartnerProposalRow[], testId: string) => (
    <ItemGroup className="gap-2" data-testid={testId}>
      {items.map((row) => (
        <Item
          key={row.id}
          variant="card"
          size="sm"
          data-testid="partner-proposal-row"
          asChild
        >
          <Link
            href={`${BASE}?proposal=${row.id}`}
            scroll={false}
            aria-current={row.id === editKey ? "true" : undefined}
          >
            <ItemContent>
              <ItemTitle>
                {operationLabel(row.operation, row.operationLabel)}
              </ItemTitle>
              <ItemDescription>
                {[
                  row.organizationName,
                  row.workspaceName,
                  t(`origin.${row.origin}`),
                  when(row.createdAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={STATUS_BADGE[row.status]}>
                {t(`status.${row.status}`)}
              </Badge>
            </ItemActions>
          </Link>
        </Item>
      ))}
    </ItemGroup>
  );

  const main = (
    <PageCanvas>
      <PageTitle
        icon={<Inbox className="size-6" />}
        title={ta("title")}
        description={ta("description")}
      />
      <Card variant="panel" className="px-4 sm:px-6">
        <CardHeader className="px-0">
          <CardTitle>{ta("awaiting", { count: open.length })}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {open.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>{ta("emptyTitle")}</EmptyTitle>
                <EmptyDescription>{ta("empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            list(open, "partner-proposals-open")
          )}
        </CardContent>
      </Card>
      <Card variant="panel" className="px-4 sm:px-6">
        <CardHeader className="px-0">
          <CardTitle>{ta("history", { count: history.length })}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {history.length === 0 ? (
            <p className="text-12 text-text-secondary">{ta("noHistory")}</p>
          ) : (
            list(history, "partner-proposals-history")
          )}
        </CardContent>
      </Card>
    </PageCanvas>
  );

  const panel =
    selected && detail ? (
      <PartnerProposalPanel
        row={selected}
        detail={detail}
        operationLabel={operationLabel(
          detail.proposal.operation,
          detail.proposal.operationLabel,
        )}
        when={when}
      />
    ) : null;

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={ta("panelLabel")}
      closeHref={BASE}
      editKey={panel ? editKey : null}
      defaultPanelSize="wide"
    />
  );
}

async function PartnerProposalPanel({
  row,
  detail,
  operationLabel,
  when,
}: Readonly<{
  row: PartnerProposalRow;
  detail: Readonly<{
    proposal: Awaited<ReturnType<typeof getProposal>>;
    operation: Awaited<ReturnType<typeof loadProposalTarget>>["operation"];
    current: Record<string, unknown> | null;
  }>;
  operationLabel: string;
  when: (date: Date) => string;
}>) {
  const t = await getTranslations("proposals");
  const ta = await getTranslations("proposals.admin");
  const { proposal, operation, current } = detail;
  const opKey = `operations.${proposal.operation.replaceAll(".", "_")}`;
  const fields = (
    operation?.fields.map((f) => ({
      key: f.key,
      label: t.has(`${opKey}.fields.${f.key}`)
        ? t(`${opKey}.fields.${f.key}`)
        : f.label,
    })) ?? Object.keys(proposal.payload).map((key) => ({ key, label: key }))
  ).filter((f) => f.key in proposal.payload);
  const errorKey = `errorReasons.${proposal.errorCode ?? ""}`;

  return (
    <div
      className="flex flex-col gap-4 p-4 md:p-6"
      data-testid="partner-proposal-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-18 text-text font-semibold">{operationLabel}</h2>
        <Badge
          variant={STATUS_BADGE[proposal.status]}
          data-testid="partner-proposal-status"
        >
          {t(`status.${proposal.status}`)}
        </Badge>
      </div>
      <Card variant="surface" className="px-4">
        <CardContent className="px-0">
          <KeyValueList
            items={[
              { label: ta("customer"), value: row.organizationName || "-" },
              { label: ta("workspace"), value: row.workspaceName || "-" },
              { label: ta("origin"), value: t(`origin.${proposal.origin}`) },
              { label: ta("createdAt"), value: when(proposal.createdAt) },
              { label: ta("expiresAt"), value: when(proposal.expiresAt) },
              ...(proposal.reason
                ? [{ label: ta("reason"), value: proposal.reason }]
                : []),
              ...(proposal.status === "failed" && proposal.errorCode
                ? [
                    {
                      label: ta("status"),
                      value: t("detail.notExecuted", {
                        reason: t.has(errorKey)
                          ? t(errorKey)
                          : proposal.errorCode,
                      }),
                    },
                  ]
                : []),
            ]}
          />
        </CardContent>
      </Card>
      <Card variant="surface" className="px-4">
        <CardHeader className="px-0">
          <CardTitle>{ta("proposed")}</CardTitle>
          <CardDescription>
            {ta("hash")}:{" "}
            <code data-testid="partner-proposal-hash">
              {proposal.payloadHash.slice(0, 16)}
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table variant="soft" data-testid="partner-proposal-fields">
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.field")}</TableHead>
                {proposal.targetId ? (
                  <TableHead>{t("detail.current")}</TableHead>
                ) : null}
                <TableHead>{t("detail.proposed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="text-text-secondary">
                    {f.label}
                  </TableCell>
                  {proposal.targetId ? (
                    <TableCell className="text-text-secondary">
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
        </CardContent>
      </Card>
      {proposal.status === "pending" ? (
        <div
          className="flex flex-wrap gap-3"
          data-testid="partner-proposal-decision"
        >
          <ActionForm
            action={approvePartnerProposalAction}
            submitLabel={t("detail.approve")}
            testId="approve-partner-proposal"
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input
              type="hidden"
              name="payloadHash"
              value={proposal.payloadHash}
            />
          </ActionForm>
          <ActionForm
            action={rejectPartnerProposalAction}
            submitLabel={t("detail.reject")}
            tone="neutral"
            testId="reject-partner-proposal"
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
          </ActionForm>
        </div>
      ) : (
        <p className="text-12 text-text-secondary">{ta("decided")}</p>
      )}
    </div>
  );
}
