import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Hand } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { HelloWorldPermissions } from "@/modules/hello-world/manifest";
import {
  listHelloWorldRecords,
  resolveHelloWorldGreeting,
} from "@/modules/hello-world/server";

export const metadata: Metadata = { title: "Hello World" };

const ORIGIN_LABELS = {
  workspace: "Definida neste workspace",
  global: "Herdada da política global",
  fallback: "Padrão do módulo",
} as const;

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/** Thin wrapper (Adendo §8): resolves context and calls the module services. */
export default async function HelloWorldPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/hello-world`);
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
    const [greeting, { records, limit }] = await Promise.all([
      resolveHelloWorldGreeting(tx, context),
      listHelloWorldRecords(tx, context),
    ]);
    return { kind: "ok" as const, greeting, count: records.length, limit };
  });
  if (view.kind === "missing") notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={["Módulos", "Hello World"]}
        title="Hello World"
        description="Módulo de referência do contrato de módulos (somente desenvolvimento e testes)."
        icon={<Hand className="h-5 w-5" />}
      />
      {view.kind === "ok" ? (
        <div className="border-card-border bg-surface-card space-y-3 rounded-xl border p-6 shadow-xs">
          <p
            className="text-24 text-text font-bold"
            data-testid="hello-greeting"
          >
            {view.greeting.greeting}
          </p>
          <p className="text-12 text-text-secondary">
            {ORIGIN_LABELS[view.greeting.origin]}
          </p>
          <p className="text-12 text-text-secondary">
            {view.count} de {view.limit} registros de demonstração.{" "}
            <Link
              href={`/app/${workspaceSlug}/hello-world/records`}
              className="underline"
            >
              Ver registros
            </Link>
          </p>
        </div>
      ) : (
        <ModuleNotice variant={view.kind} />
      )}
    </div>
  );
}
