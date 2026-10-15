import type { Metadata } from "next";
import { Cpu } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { AiTabs } from "@/components/ai-agents/ai-tabs";
import { ProvidersForm } from "@/components/ai-agents/providers-form";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { savePlatformAiProvidersAction } from "@/core/ai/console-actions";
import { aiProvidersView } from "@/core/ai/provider-settings";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { requireAiModule, requirePlatformAiRole } from "../guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("providersPage.metaTitle") };
}

/**
 * IA › Provedores e modelos of the platform (CF6a): providers on, the
 * catalog of models of each one and the optional gateway (base URL).
 */
export default async function PlatformAiProvidersPage() {
  requireAiModule();
  const identity = await requirePlatformAdminPage("/platform/ai/providers");
  const role = await requirePlatformAiRole(identity.userId);
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    aiProvidersView(tx, {
      level: "platform",
      userId: identity.userId,
      platformRole: role,
    }),
  );
  const t = await getTranslations("aiConsole");

  return (
    <div
      className="mx-auto max-w-4xl space-y-6"
      data-testid="platform-ai-providers"
    >
      <ModulePageHeader
        title={t("providersPage.title")}
        description={t("providersPage.description")}
        icon={<Cpu className="h-5 w-5" />}
      />
      <AiTabs active="providers" />
      <ProvidersForm
        level="platform"
        inherited={view.inherited}
        effective={view.effective}
        baseUrls={view.baseUrls}
        canEdit={view.canEdit}
        action={savePlatformAiProvidersAction}
      />
    </div>
  );
}
