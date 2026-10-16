import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";

import { ExampleDemo } from "./example-demo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designLab.example");
  return { title: t("title") };
}

/**
 * Plataforma › Padrões de interface › Página modelo (U4, ADR 0021): a whole
 * page built only from the model components, with sample data, for visual
 * approval and as the reference layout. Nothing here reads or writes data.
 */
export default async function ExampleDesignPage() {
  const identity = await requirePlatformAdminPage("/platform/design/example");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.modules.read")) {
    return <ModuleNotice variant="denied" />;
  }
  return <ExampleDemo />;
}
