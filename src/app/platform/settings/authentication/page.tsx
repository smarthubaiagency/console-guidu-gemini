import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LoginMethodSettings } from "@/components/authentication/login-method-settings";
import { SignupCard } from "@/components/authentication/signup-card";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { providerFlags } from "@/core/auth/login-methods";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { savePlatformLoginMethodAction } from "@/core/auth/settings-actions";
import { platformGrants } from "@/core/module-runtime/loaders";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Autenticação (Plataforma)" };

/**
 * Plataforma › Configurações › Autenticação (CF5b): sign-up and e-mail
 * verification (read only), Google and the link by e-mail offered to the
 * partners. Supabase Auth itself is never changed from here.
 */
export default async function PlatformAuthenticationSettingsPage() {
  const identity = await requirePlatformAdminPage(
    "/platform/settings/authentication",
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.security.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    settingsView(tx, {
      level: "platform",
      userId: identity.userId,
      platformRole: role,
    }),
  );
  const providers = providerFlags();
  const t = await getTranslations("authSettings");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.platform")}
        icon={<KeyRound className="h-5 w-5" />}
      />
      <SignupCard securityHref="/platform/settings/security" />
      <LoginMethodSettings
        method="google"
        view={view}
        providers={providers}
        action={savePlatformLoginMethodAction}
      />
      <LoginMethodSettings
        method="magicLink"
        view={view}
        providers={providers}
        action={savePlatformLoginMethodAction}
      />
    </>
  );
}
