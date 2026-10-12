import Link from "next/link";
import { notFound } from "next/navigation";
import { Hand } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { HelloWorldPermissions } from "@/modules/hello-world/manifest";
import {
  listHelloWorldRecords,
  resolveHelloWorldGreeting,
} from "@/modules/hello-world/server";

export async function generateMetadata() {
  const t = await getTranslations("helloWorld");
  return { title: t("home.metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/** Thin wrapper (Adendo §8): resolves context and calls the module services. */
export default async function HelloWorldPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/hello-world`);
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
    const [greeting, { records, limit }] = await Promise.all([
      resolveHelloWorldGreeting(tx, context),
      listHelloWorldRecords(tx, context),
    ]);
    return { kind: "ok" as const, greeting, count: records.length, limit };
  });
  if (view.kind === "missing") notFound();
  const t = await getTranslations("helloWorld");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={[t("breadcrumbModules"), t("breadcrumbHelloWorld")]}
        title={t("home.title")}
        description={t("home.description")}
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
            {t(`home.origin.${view.greeting.origin}`)}
          </p>
          <p className="text-12 text-text-secondary">
            {view.limit === null
              ? t("home.count", { count: view.count })
              : t("home.countOfLimit", {
                  count: view.count,
                  limit: view.limit,
                })}{" "}
            <Link
              href={`/app/${workspaceSlug}/hello-world/records`}
              className="underline"
            >
              {t("home.viewRecords")}
            </Link>
          </p>
        </div>
      ) : (
        <ModuleNotice variant={view.kind} />
      )}
    </div>
  );
}
