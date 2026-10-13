import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TemplatesWorkbench } from "@/components/ai-agents/templates-workbench";
import { ModuleNotice } from "@/components/modules/module-notice";
import {
  createPartnerTemplateAction,
  deletePartnerTemplateAction,
  savePartnerTemplateAction,
} from "@/core/ai/console-actions";
import { loadTemplatesView, type TemplateActor } from "@/core/ai/templates";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("partnerTemplates.metaTitle") };
}

const BASE = "/admin/ai/templates";

/**
 * GUIDS templates of the partner (A3b, especificação §5.1): its customers
 * see them, published, next to the house's when they create a GUIDS.
 */
export default async function PartnerAiTemplatesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ edit?: string }> }>) {
  if (!isModuleTechnicallyAvailable("ai-agents")) notFound();
  const { identity, partner, membership } =
    await requirePartnerConsolePage(BASE);
  if (!partnerGrants(membership.role)("partner.ai_agents.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const { edit } = await searchParams;
  const editKey = typeof edit === "string" && edit ? edit : null;
  const actor: TemplateActor = {
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership.role,
  };
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => loadTemplatesView(tx, actor, editKey),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("aiConsole");

  return (
    <TemplatesWorkbench
      base={BASE}
      title={t("partnerTemplates.title")}
      description={t("partnerTemplates.description")}
      publishedLabel={t("partnerTemplates.published")}
      templates={view.templates}
      opened={view.opened}
      editKey={editKey}
      actions={{
        create: createPartnerTemplateAction,
        save: savePartnerTemplateAction,
        delete: deletePartnerTemplateAction,
      }}
      testId="partner-ai-templates"
    />
  );
}
