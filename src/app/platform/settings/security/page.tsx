import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { IpAllowlistSettings } from "@/components/security/ip-allowlist-settings";
import { MfaSettings } from "@/components/security/mfa-settings";
import { PasswordSessionCard } from "@/components/security/password-session-card";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import {
  savePlatformAllowlistAction,
  savePlatformSecurityAction,
} from "@/core/security/actions";
import { allowlistView } from "@/core/security/ip-allowlist";
import { requestClientIp } from "@/core/security/ip-gate";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Segurança (Plataforma)" };

/**
 * Plataforma › Configurações › Segurança (CF5a): MFA by area, the /platform
 * IP allow list, and where password and session rules live.
 */
export default async function PlatformSecuritySettingsPage() {
  const identity = await requirePlatformAdminPage(
    "/platform/settings/security",
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.role ?? null;
  if (!platformGrants(role)("platform.security.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const currentIp = await requestClientIp();
  const { view, list } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      view: await settingsView(tx, {
        level: "platform",
        userId: identity.userId,
        platformRole: role,
      }),
      list: await allowlistView(
        tx,
        { area: "platform", userId: identity.userId, platformRole: role },
        currentIp,
      ),
    }),
  );
  const t = await getTranslations("security");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.platform")}
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <MfaSettings view={view} action={savePlatformSecurityAction} />
      <IpAllowlistSettings view={list} action={savePlatformAllowlistAction} />
      <PasswordSessionCard />
    </>
  );
}
