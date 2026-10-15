import type { Metadata } from "next";
import { Plug } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  GoogleAppCard,
  GoogleScopesCard,
} from "@/components/integrations/google-app-cards";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import {
  deletePartnerGoogleAppAction,
  savePartnerGoogleAppAction,
  savePartnerGoogleScopesAction,
} from "@/core/integrations/google/actions";
import { googleAppView } from "@/core/integrations/google/apps";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("integrations");
  return { title: t("google.metaTitle") };
}

/**
 * Admin › Configurações › Integrações › Google (CF6b): the partner's own
 * OAuth app (optional, its brand on the consent screen; without it the
 * customers use the GUIDU's) and the scopes it leaves to its customers,
 * within what the platform offers. Owner and admin edit.
 */
export default async function PartnerGoogleIntegrationPage() {
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/settings/integrations",
  );
  if (!partnerGrants(membership.role)("partner.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      googleAppView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("integrations");
  return (
    <>
      <ModulePageHeader
        title={t("google.title")}
        description={t("google.description.partner")}
        icon={<Plug className="h-5 w-5" />}
      />
      <GoogleAppCard
        view={view}
        saveAction={savePartnerGoogleAppAction}
        removeAction={deletePartnerGoogleAppAction}
      />
      <GoogleScopesCard view={view} action={savePartnerGoogleScopesAction} />
    </>
  );
}
