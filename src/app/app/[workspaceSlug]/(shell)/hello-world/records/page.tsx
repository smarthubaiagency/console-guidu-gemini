import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { List, Plus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { RecordWorkbench, WorkbenchPanel } from "@/components/layout/workbench";
import { Button } from "@/components/ui/button";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { CreateRecordForm } from "@/modules/hello-world/client";
import { HelloWorldPermissions } from "@/modules/hello-world/manifest";
import {
  getHelloWorldRecord,
  listHelloWorldRecords,
} from "@/modules/hello-world/server";
import { AppError } from "@/shared/errors";

export async function generateMetadata() {
  const t = await getTranslations("helloWorld");
  return { title: t("records.metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ edit?: string }>;
}

/**
 * Records of the reference module: list, with creating and reading in the
 * internal drawer (ADR 0015) at `?edit=new` or `?edit=<id>`.
 */
export default async function HelloWorldRecordsPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug } = await params;
  const { edit } = await searchParams;
  const editKey = typeof edit === "string" && edit ? edit : null;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/hello-world/records`,
  );
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }

  const view = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "hello-world",
      HelloWorldPermissions.READ,
    );
    if (access.kind !== "ok") return access;
    const { records, limit } = await listHelloWorldRecords(tx, context);
    let opened = null;
    if (editKey && editKey !== "new") {
      try {
        opened = await getHelloWorldRecord(tx, context, editKey);
      } catch (err) {
        if (!(err instanceof AppError && err.code === "not_found")) throw err;
      }
    }
    return {
      kind: "ok" as const,
      records,
      limit,
      opened,
      canWrite: access.can(HelloWorldPermissions.RECORDS_WRITE),
      readOnly: access.readOnly,
    };
  });
  if (view.kind === "missing") notFound();
  const t = await getTranslations("helloWorld");
  const format = await getFormatter();

  const base = `/app/${workspaceSlug}/hello-world/records`;
  const canCreate =
    view.kind === "ok" &&
    view.canWrite &&
    !view.readOnly &&
    (view.limit === null || view.records.length < view.limit);
  const createdAt = (iso: string) =>
    t("records.dateUtc", {
      date: format.dateTime(new Date(iso), {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "UTC",
      }),
    });

  let panel: React.ReactNode = null;
  if (editKey === "new" && canCreate) {
    panel = (
      <WorkbenchPanel title={t("records.new")}>
        <CreateRecordForm workspaceSlug={workspaceSlug} />
      </WorkbenchPanel>
    );
  } else if (view.kind === "ok" && view.opened) {
    const record = view.opened;
    panel = (
      <WorkbenchPanel title={record.title}>
        <dl className="text-12 grid gap-3">
          <div>
            <dt className="text-text-secondary">{t("record.id")}</dt>
            <dd className="text-text font-mono break-all">{record.id}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">{t("record.createdAt")}</dt>
            <dd className="text-text">{createdAt(record.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">{t("record.author")}</dt>
            <dd className="text-text">
              {record.createdByMe ? t("record.you") : t("record.otherMember")}
            </dd>
          </div>
        </dl>
      </WorkbenchPanel>
    );
  }

  const main = (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        title={t("records.title")}
        description={t("records.description")}
        icon={<List className="h-5 w-5" />}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href={`${base}?edit=new`} scroll={false}>
                <Plus />
                {t("records.new")}
              </Link>
            </Button>
          ) : null
        }
      />
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : (
        <>
          {view.readOnly ? (
            <p
              className="text-12 text-text-secondary"
              data-testid="module-read-only"
            >
              {t("records.readOnly")}
            </p>
          ) : !view.canWrite ? (
            <p className="text-12 text-text-secondary">
              {t("records.readOnlyRole")}
            </p>
          ) : !canCreate && view.limit !== null ? (
            <p className="text-12 text-text-secondary">
              {t("records.limitReached", { limit: view.limit })}
            </p>
          ) : null}
          {view.records.length === 0 ? (
            <p className="text-12 text-text-secondary">{t("records.empty")}</p>
          ) : (
            <ul className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
              {view.records.map((record) => (
                <li
                  key={record.id}
                  className="flex items-center justify-between p-4"
                >
                  <Link
                    href={`${base}?edit=${record.id}`}
                    scroll={false}
                    aria-current={record.id === editKey ? "true" : undefined}
                    className="text-14 text-text font-medium hover:underline"
                  >
                    {record.title}
                  </Link>
                  <span className="text-11 text-text-tertiary">
                    {createdAt(record.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("record.panelLabel")}
      closeHref={base}
      editKey={editKey}
    />
  );
}
