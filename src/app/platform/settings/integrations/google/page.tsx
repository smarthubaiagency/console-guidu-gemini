import type { Metadata } from "next";
import { Plug } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  GoogleAppCard,
  GoogleScopesCard,
} from "@/components/integrations/google-app-cards";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  savePlatformGoogleAppAction,
  savePlatformGoogleScopesAction,
} from "@/core/integrations/google/actions";
import { googleAppView } from "@/core/integrations/google/apps";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("integrations");
  return { title: t("google.metaTitle") };
}

/**
 * Plataforma › Configurações › Integrações › Google (CF6b): the GUIDU's
 * OAuth app (one Google verification for every customer) and the scopes
 * offered to the workspaces. The settings managers edit it.
 */
export default async function PlatformGoogleIntegrationPage() {
  const identity = await requirePlatformAdminPage(
    "/platform/settings/integrations/google",
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.settings.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    googleAppView(tx, {
      level: "platform",
      userId: identity.userId,
      platformRole: role,
    }),
  );
  const t = await getTranslations("integrations");
  return (
    <>
      <ModulePageHeader
        title={t("google.title")}
        description={t("google.description.platform")}
        icon={<Plug className="h-5 w-5" />}
      />
      <GoogleAppCard view={view} saveAction={savePlatformGoogleAppAction} />
      <GoogleScopesCard view={view} action={savePlatformGoogleScopesAction} />
    </>
  );
}
