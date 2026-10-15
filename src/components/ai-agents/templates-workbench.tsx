import Link from "next/link";
import { Bot, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { calendarDateFormatter } from "@/components/billing/billing-ui";
import { RecordWorkbench, WorkbenchPanel } from "@/components/layout/workbench";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AiConsoleActionState } from "@/core/ai/console-actions";
import type { AiPolicy } from "@/core/ai/models";
import type {
  TemplateDetailDto,
  TemplateSummaryDto,
} from "@/core/ai/templates";

import { CreateTemplateForm, TemplateEditorPanel } from "./template-forms";

type FormAction = (
  prev: AiConsoleActionState,
  formData: FormData,
) => Promise<AiConsoleActionState>;

/**
 * List of agent templates with the editor in the internal drawer (ADR
 * 0015) at `?edit=<id>`; `?edit=new` creates one. Shared by the house's
 * templates in `/platform` (A3a) and the partner's in `/admin` (A3b).
 */
export async function TemplatesWorkbench({
  base,
  title,
  description,
  publishedLabel,
  templates,
  opened,
  editKey,
  actions,
  testId,
  tabs,
  policy,
}: Readonly<{
  base: string;
  title: string;
  description: string;
  publishedLabel: string;
  templates: readonly TemplateSummaryDto[];
  opened: TemplateDetailDto | null;
  editKey: string | null;
  actions: Readonly<{
    create: FormAction;
    save: FormAction;
    delete: FormAction;
  }>;
  testId: string;
  /** The console's tabs above the list (IA in /platform, CF6a). */
  tabs?: React.ReactNode;
  /** Providers and models of the console's level, for the editor (CF6a). */
  policy?: AiPolicy | undefined;
}>) {
  const t = await getTranslations("aiConsole");
  const formatDate = await calendarDateFormatter();

  let panel: React.ReactNode = null;
  if (editKey === "new") {
    panel = (
      <WorkbenchPanel title={t("templates.new")}>
        <CreateTemplateForm createAction={actions.create} />
      </WorkbenchPanel>
    );
  } else if (opened) {
    panel = (
      <TemplateEditorPanel
        key={opened.id}
        template={opened}
        saveAction={actions.save}
        deleteAction={actions.delete}
        publishedLabel={publishedLabel}
        policy={policy}
      />
    );
  }

  const main = (
    <div className="mx-auto max-w-4xl space-y-6" data-testid={testId}>
      <ModulePageHeader
        title={title}
        description={description}
        icon={<Bot className="h-5 w-5" />}
        actions={
          <Button asChild>
            <Link href={`${base}?edit=new`} scroll={false}>
              <Plus />
              {t("templates.new")}
            </Link>
          </Button>
        }
      />
      {tabs}
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
                href={`${base}?edit=${template.id}`}
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
      closeHref={base}
      editKey={editKey}
      defaultPanelSize="wide"
    />
  );
}
