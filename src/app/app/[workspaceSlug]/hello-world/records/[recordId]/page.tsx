import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { HelloWorldPermissions } from "@/modules/hello-world/manifest";
import { getHelloWorldRecord } from "@/modules/hello-world/server";
import { AppError } from "@/shared/errors";

export const metadata: Metadata = { title: "Registro — Hello World" };

interface PageProps {
  params: Promise<{ workspaceSlug: string; recordId: string }>;
}

export default async function HelloWorldRecordPage({ params }: PageProps) {
  const { workspaceSlug, recordId } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/hello-world/records/${recordId}`,
  );
  let context;
  try {
    context = await resolveWorkspaceContext(
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
    try {
      return {
        kind: "ok" as const,
        record: await getHelloWorldRecord(tx, context, recordId),
      };
    } catch (err) {
      if (err instanceof AppError && err.code === "not_found")
        return { kind: "missing" as const };
      throw err;
    }
  });
  if (view.kind === "missing") notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={["Módulos", "Hello World", "Registros"]}
        title={view.kind === "ok" ? view.record.title : "Registro"}
        icon={<FileText className="h-5 w-5" />}
      />
      {view.kind === "ok" ? (
        <dl className="border-card-border bg-surface-card text-12 grid grid-cols-3 gap-3 rounded-xl border p-5 shadow-xs">
          <dt className="text-text-secondary">Identificador</dt>
          <dd className="text-text col-span-2 font-mono">{view.record.id}</dd>
          <dt className="text-text-secondary">Criado em</dt>
          <dd className="text-text col-span-2">
            {new Date(view.record.createdAt).toLocaleString("pt-BR", {
              timeZone: "UTC",
            })}{" "}
            UTC
          </dd>
          <dt className="text-text-secondary">Autor</dt>
          <dd className="text-text col-span-2">
            {view.record.createdByMe ? "Você" : "Outro membro"}
          </dd>
        </dl>
      ) : (
        <ModuleNotice variant={view.kind} />
      )}
      <Link
        href={`/app/${workspaceSlug}/hello-world/records`}
        className="text-12 underline"
      >
        Voltar aos registros
      </Link>
    </div>
  );
}
