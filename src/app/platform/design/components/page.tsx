import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";

import { ComponentsDemo } from "./components-demo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designLab.components");
  return { title: t("title") };
}

/**
 * Plataforma › Configurações › Padrões de interface › Componentes (ADR 0014):
 * the shadcn components every screen uses, for approval and as a pattern
 * catalogue. Nothing on this page reads or writes data.
 */
export default async function ComponentsDesignPage() {
  const identity = await requirePlatformAdminPage(
    "/platform/design/components",
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.modules.read")) {
    return <ModuleNotice variant="denied" />;
  }
  return <ComponentsDemo />;
}
