import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";

import { type DemoKey, WorkbenchDemo } from "./workbench-demo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designLab");
  return { title: t("title") };
}

function demoKey(value: string | string[] | undefined): DemoKey {
  return value === "chat" || value === "simple" ? value : "edit";
}

/**
 * Plataforma › Configurações › Padrões de interface (U2a): the workbench
 * (ADR 0015) with sample rows, for approval and as a pattern catalogue.
 * Nothing on this page reads or writes data.
 */
export default async function WorkbenchDesignPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const identity = await requirePlatformAdminPage("/platform/design/workbench");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.modules.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const { demo } = await searchParams;
  return <WorkbenchDemo demo={demoKey(demo)} />;
}
