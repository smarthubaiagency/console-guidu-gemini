import Link from "next/link";
import { Inbox } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { displayValue } from "@/core/proposals/labels";
import { listProposals, type ProposalView } from "@/core/proposals/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata() {
  const t = await getTranslations("proposals");
  return { title: t("metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

function summary(p: ProposalView): string {
  const name = p.payload.name;
  return typeof name === "string" ? name : displayValue(p.targetId);
}

async function ProposalList({
  items,
  base,
  testId,
}: Readonly<{ items: ProposalView[]; base: string; testId: string }>) {
  const t = await getTranslations("proposals");
  const format = await getFormatter();
  const operationLabel = (p: ProposalView): string => {
    const key = `operations.${p.operation.replaceAll(".", "_")}.label`;
    return t.has(key) ? t(key) : p.operationLabel;
  };
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
            {operationLabel(p)}: {summary(p)}
          </Link>
          <span className="text-12 text-text-secondary">
            {t("list.rowMeta", {
              status: t(`status.${p.status}`),
              date: format.dateTime(p.createdAt, {
                dateStyle: "short",
                timeZone: "UTC",
              }),
            })}
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
  const t = await getTranslations("proposals");

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="proposals">
      <ModulePageHeader
        trail={[t("trail.platform"), t("trail.proposals")]}
        title={t("metaTitle")}
        description={t("list.description")}
        icon={<Inbox className="h-5 w-5" />}
      />
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          {t("list.awaiting", { count: open.length })}
        </h2>
        {open.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("list.noneWaiting")}</p>
        ) : (
          <ProposalList items={open} base={base} testId="proposals-open" />
        )}
      </section>
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("list.history")}</h2>
        {history.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("list.noHistory")}</p>
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
