import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Cpu } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ProvidersForm } from "@/components/ai-agents/providers-form";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { savePartnerAiProvidersAction } from "@/core/ai/console-actions";
import { aiProvidersView } from "@/core/ai/provider-settings";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("providersPage.metaTitle") };
}

/**
 * The partner narrows the providers and models its customers may choose
 * (CF6a, ADR 0018), within what the platform allows.
 */
export default async function PartnerAiProvidersPage() {
  if (!isModuleTechnicallyAvailable("ai-agents")) notFound();
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/ai/providers",
  );
  if (!partnerGrants(membership.role)("partner.ai_agents.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      aiProvidersView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("aiConsole");

  return (
    <div
      className="mx-auto max-w-4xl space-y-6"
      data-testid="partner-ai-providers"
    >
      <ModulePageHeader
        title={t("providersPage.title")}
        description={t("providersPage.partnerDescription")}
        icon={<Cpu className="h-5 w-5" />}
      />
      <ProvidersForm
        level="partner"
        inherited={view.inherited}
        effective={view.effective}
        baseUrls={view.baseUrls}
        canEdit={view.canEdit}
        action={savePartnerAiProvidersAction}
      />
    </div>
  );
}
