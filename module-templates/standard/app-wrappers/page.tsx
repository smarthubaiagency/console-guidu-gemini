// Copiar para src/app/app/[workspaceSlug]/__MODULE_KEY__/page.tsx.
import { notFound } from "next/navigation";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { __ModuleName__Permissions } from "@/modules/__MODULE_KEY__/manifest";
import { list__ModuleName__Items } from "@/modules/__MODULE_KEY__/server";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/** Thin wrapper: resolve context on the server, then call module services. */
export default async function __ModuleName__Page({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/__MODULE_KEY__`);
  let context;
  try {
    context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);
  } catch {
    notFound();
  }

  const view = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(tx, context, "__MODULE_KEY__", __ModuleName__Permissions.READ);
    if (access.kind !== "ok") return access;
    return { kind: "ok" as const, items: await list__ModuleName__Items(tx, context) };
  });
  if (view.kind === "missing") notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader trail={["Módulos", "__MODULE_NAME__"]} title="__MODULE_NAME__" />
      {view.kind === "ok" ? <p>Sem dados.</p> : <ModuleNotice variant={view.kind} />}
    </div>
  );
}
