import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { TemplatesWorkbench } from "@/components/ai-agents/templates-workbench";
import {
  createHouseTemplateAction,
  deleteHouseTemplateAction,
  saveHouseTemplateAction,
} from "@/core/ai/console-actions";
import { loadTemplatesView, type TemplateActor } from "@/core/ai/templates";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { requireAiModule, requirePlatformAiRole } from "../guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("templates.metaTitle") };
}

const BASE = "/platform/ai/templates";

/**
 * Agent templates of the house (A3a): the Assistant's template and the
 * GUIDS templates every customer can start from.
 */
export default async function PlatformAiTemplatesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ edit?: string }> }>) {
  requireAiModule();
  const identity = await requirePlatformAdminPage(BASE);
  const role = await requirePlatformAiRole(identity.userId);
  const { edit } = await searchParams;
  const editKey = typeof edit === "string" && edit ? edit : null;
  const actor: TemplateActor = {
    userId: identity.userId,
    partnerId: null,
    platformRole: role,
  };
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    loadTemplatesView(tx, actor, editKey),
  );
  const t = await getTranslations("aiConsole");

  return (
    <TemplatesWorkbench
      base={BASE}
      title={t("templates.title")}
      description={t("templates.description")}
      publishedLabel={t("templates.form.published")}
      templates={view.templates}
      opened={view.opened}
      editKey={editKey}
      actions={{
        create: createHouseTemplateAction,
        save: saveHouseTemplateAction,
        delete: deleteHouseTemplateAction,
      }}
      testId="platform-ai-templates"
    />
  );
}
