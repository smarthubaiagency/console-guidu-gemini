import Link from "next/link";
import { notFound } from "next/navigation";
import { List } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { CreateRecordForm } from "@/modules/hello-world/client";
import { HelloWorldPermissions } from "@/modules/hello-world/manifest";
import { listHelloWorldRecords } from "@/modules/hello-world/server";

export async function generateMetadata() {
  const t = await getTranslations("helloWorld");
  return { title: t("records.metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function HelloWorldRecordsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
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
  } catch {
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
    return {
      kind: "ok" as const,
      records,
      limit,
      canWrite: access.can(HelloWorldPermissions.RECORDS_WRITE),
      readOnly: access.readOnly,
    };
  });
  if (view.kind === "missing") notFound();
  const t = await getTranslations("helloWorld");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={[
          t("breadcrumbModules"),
          t("breadcrumbHelloWorld"),
          t("records.breadcrumb"),
        ]}
        title={t("records.title")}
        description={t("records.description")}
        icon={<List className="h-5 w-5" />}
      />
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : (
        <>
          <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
            {view.readOnly ? (
              <p
                className="text-12 text-text-secondary"
                data-testid="module-read-only"
              >
                {t("records.readOnly")}
              </p>
            ) : view.canWrite ? (
              view.limit === null || view.records.length < view.limit ? (
                <CreateRecordForm workspaceSlug={workspaceSlug} />
              ) : (
                <p className="text-12 text-text-secondary">
                  {t("records.limitReached", { limit: view.limit })}
                </p>
              )
            ) : (
              <p className="text-12 text-text-secondary">
                {t("records.readOnlyRole")}
              </p>
            )}
          </div>
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
                    href={`/app/${workspaceSlug}/hello-world/records/${record.id}`}
                    className="text-14 text-text font-medium hover:underline"
                  >
                    {record.title}
                  </Link>
                  <span className="text-11 text-text-tertiary">
                    {t("records.dateUtc", {
                      date: format.dateTime(new Date(record.createdAt), {
                        dateStyle: "short",
                        timeStyle: "medium",
                        timeZone: "UTC",
                      }),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
