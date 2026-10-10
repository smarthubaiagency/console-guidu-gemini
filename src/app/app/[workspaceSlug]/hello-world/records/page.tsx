import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { List } from "lucide-react";

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

export const metadata: Metadata = { title: "Registros — Hello World" };

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
    };
  });
  if (view.kind === "missing") notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={["Módulos", "Hello World", "Registros"]}
        title="Registros de exemplo"
        description="Listar, criar e consultar registros vinculados ao workspace."
        icon={<List className="h-5 w-5" />}
      />
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : (
        <>
          <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
            {view.canWrite ? (
              view.records.length < view.limit ? (
                <CreateRecordForm workspaceSlug={workspaceSlug} />
              ) : (
                <p className="text-12 text-text-secondary">
                  Limite de demonstração atingido ({view.limit} registros por
                  workspace).
                </p>
              )
            ) : (
              <p className="text-12 text-text-secondary">
                Seu papel permite apenas consultar os registros.
              </p>
            )}
          </div>
          {view.records.length === 0 ? (
            <p className="text-12 text-text-secondary">
              Sem dados: nenhum registro criado ainda.
            </p>
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
                    {new Date(record.createdAt).toLocaleString("pt-BR", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
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
