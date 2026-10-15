import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { IpAllowlistSettings } from "@/components/security/ip-allowlist-settings";
import { MfaSettings } from "@/components/security/mfa-settings";
import { PasswordSessionCard } from "@/components/security/password-session-card";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import {
  savePartnerAllowlistAction,
  savePartnerSecurityAction,
} from "@/core/security/actions";
import { allowlistView } from "@/core/security/ip-allowlist";
import { requestClientIp } from "@/core/security/ip-gate";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Segurança (Admin)" };

/**
 * Admin › Configurações › Segurança (CF5a): MFA of the partner's customers,
 * the IP allow list of this /admin, and where password and session live.
 */
export default async function PartnerSecuritySettingsPage() {
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/settings/security",
  );
  if (!partnerGrants(membership.role)("partner.security.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const currentIp = await requestClientIp();
  const { view, list } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      view: await settingsView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
      list: await allowlistView(
        tx,
        {
          area: "admin",
          userId: identity.userId,
          partnerId: partner.partnerId,
          partnerRole: membership.role,
        },
        currentIp,
      ),
    }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("security");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <MfaSettings view={view} action={savePartnerSecurityAction} />
      <IpAllowlistSettings view={list} action={savePartnerAllowlistAction} />
      <PasswordSessionCard />
    </>
  );
}
