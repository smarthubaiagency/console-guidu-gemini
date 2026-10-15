import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LoginMethodSettings } from "@/components/authentication/login-method-settings";
import { SignupCard } from "@/components/authentication/signup-card";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { providerFlags } from "@/core/auth/login-methods";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { savePartnerLoginMethodAction } from "@/core/auth/settings-actions";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Autenticação (Admin)" };

/**
 * Admin › Configurações › Autenticação (CF5b): sign-up and e-mail
 * verification (read only), and whether the partner's hosts show the
 * methods the platform offers.
 */
export default async function PartnerAuthenticationSettingsPage() {
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/settings/authentication",
  );
  if (!partnerGrants(membership.role)("partner.security.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      settingsView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
    { partnerId: partner.partnerId },
  );
  const providers = providerFlags();
  const t = await getTranslations("authSettings");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<KeyRound className="h-5 w-5" />}
      />
      <SignupCard securityHref="/admin/settings/security" />
      <LoginMethodSettings
        method="google"
        view={view}
        providers={providers}
        action={savePartnerLoginMethodAction}
      />
      <LoginMethodSettings
        method="magicLink"
        view={view}
        providers={providers}
        action={savePartnerLoginMethodAction}
      />
    </>
  );
}
