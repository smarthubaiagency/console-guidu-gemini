import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { calendarDateFormatter } from "@/components/billing/billing-ui";
import { RecordWorkbench, WorkbenchPanel } from "@/components/layout/workbench";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getTemplate,
  listTemplates,
  type TemplateActor,
  type TemplateDetailDto,
} from "@/core/ai/templates";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { requireAiModule, requirePlatformAiRole } from "../guard";
import { CreateTemplateForm, TemplateEditorPanel } from "./template-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("templates.metaTitle") };
}

const BASE = "/platform/ai/templates";

/**
 * Agent templates of the house (A3a): the Assistant's template and the
 * GUIDS templates every customer can start from. The editor opens in the
 * internal drawer (ADR 0015) at `?edit=<id>`; `?edit=new` creates one.
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

  const { templates, opened } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => {
      const templates = await listTemplates(tx, actor);
      let opened: TemplateDetailDto | null = null;
      if (editKey && editKey !== "new") {
        try {
          opened = await getTemplate(tx, actor, editKey);
        } catch (err) {
          if (!(err instanceof AppError && err.code === "not_found")) throw err;
        }
      }
      return { templates, opened };
    },
  );
  const t = await getTranslations("aiConsole");
  const formatDate = await calendarDateFormatter();

  let panel: React.ReactNode = null;
  if (editKey === "new") {
    panel = (
      <WorkbenchPanel title={t("templates.new")}>
        <CreateTemplateForm />
      </WorkbenchPanel>
    );
  } else if (opened) {
    panel = <TemplateEditorPanel key={opened.id} template={opened} />;
  }

  const main = (
    <div
      className="mx-auto max-w-4xl space-y-6"
      data-testid="platform-ai-templates"
    >
      <ModulePageHeader
        title={t("templates.title")}
        description={t("templates.description")}
        icon={<Bot className="h-5 w-5" />}
        actions={
          <Button asChild>
            <Link href={`${BASE}?edit=new`} scroll={false}>
              <Plus />
              {t("templates.new")}
            </Link>
          </Button>
        }
      />
      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="template-list"
      >
        {templates.map((template) => (
          <li
            key={template.id}
            className="flex flex-wrap items-center justify-between gap-2 p-4"
            data-testid="template-row"
          >
            <div className="min-w-0 space-y-1">
              <Link
                href={`${BASE}?edit=${template.id}`}
                scroll={false}
                aria-current={template.id === editKey ? "true" : undefined}
                className="text-14 text-text font-medium hover:underline"
              >
                {template.name}
              </Link>
              <p className="text-12 text-text-secondary">
                {[
                  t(`templates.kind.${template.kind}`),
                  template.segment,
                  t("templates.version", { version: template.version }),
                  t("templates.updated", {
                    date: formatDate(new Date(template.updatedAt)),
                  }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Badge variant={template.published ? "default" : "secondary"}>
              {template.published
                ? t("templates.published")
                : t("templates.draft")}
            </Badge>
          </li>
        ))}
        {templates.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            {t("templates.empty")}
          </li>
        ) : null}
      </ul>
    </div>
  );

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("templates.panelLabel")}
      closeHref={BASE}
      editKey={editKey}
      defaultPanelSize="wide"
    />
  );
}
