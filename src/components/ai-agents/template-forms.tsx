"use client";

import { useTranslations } from "next-intl";
import { useActionState, useTransition } from "react";

import { AgentConfigEditor } from "@/components/ai-agents/agent-config-editor";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { useStatus } from "@/components/feedback/status-context";
import { WorkbenchPanel } from "@/components/layout/workbench";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { agentKindOfTemplate } from "@/core/ai/config/schema";
import type { AiConsoleActionState } from "@/core/ai/console-actions";
import type { TemplateDetailDto } from "@/core/ai/templates";

/**
 * Forms of the agent templates (A3a and A3b), shared by `/platform` (the
 * house's) and `/admin` (the partner's): each console passes its actions.
 */

type FormAction = (
  prev: AiConsoleActionState,
  formData: FormData,
) => Promise<AiConsoleActionState>;

const INITIAL: AiConsoleActionState = {};
const FORM_ID = "template-form";

function FieldError({ message }: Readonly<{ message: string | undefined }>) {
  return message ? (
    <p className="text-11 text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

/** Name, description and segment of a template. */
function MetaFields({
  name,
  description,
  segment,
  errors,
}: Readonly<{
  name?: string;
  description?: string | null;
  segment?: string | null;
  errors: Readonly<Record<string, string>>;
}>) {
  const t = useTranslations("aiConsole.templates.form");
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="template-name" className="text-12">
          {t("name")}
        </Label>
        <Input
          id="template-name"
          name="name"
          required
          maxLength={80}
          defaultValue={name ?? ""}
          aria-invalid={Boolean(errors.name) || undefined}
        />
        <FieldError message={errors.name} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="template-segment" className="text-12">
          {t("segment")}
        </Label>
        <Input
          id="template-segment"
          name="segment"
          maxLength={80}
          defaultValue={segment ?? ""}
        />
        <FieldError message={errors.segment} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="template-description" className="text-12">
          {t("description")}
        </Label>
        <Textarea
          id="template-description"
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={description ?? ""}
        />
        <FieldError message={errors.description} />
      </div>
    </div>
  );
}

/** A new GUIDS template: name first, the configuration after. */
export function CreateTemplateForm({
  createAction,
}: Readonly<{ createAction: FormAction }>) {
  const t = useTranslations("aiConsole.templates.form");
  const [state, action, pending] = useActionState(createAction, INITIAL);
  useActionStatus(state);
  return (
    <form action={action} className="space-y-4" data-testid="create-template">
      <p className="text-12 text-text-secondary">{t("createHint")}</p>
      <MetaFields errors={state.fieldErrors ?? {}} />
      <Button type="submit" disabled={pending}>
        {t("create")}
      </Button>
    </form>
  );
}

/**
 * Editor of a template in the drawer: name, publication and the five tabs
 * of the configuration, with Save and Delete in the footer.
 */
export function TemplateEditorPanel({
  template,
  saveAction,
  deleteAction,
  publishedLabel,
}: Readonly<{
  template: TemplateDetailDto;
  saveAction: FormAction;
  deleteAction: FormAction;
  /** Who sees a published template, in the console's words. */
  publishedLabel: string;
}>) {
  const t = useTranslations("aiConsole.templates");
  const [state, action, pending] = useActionState(saveAction, INITIAL);
  useActionStatus(state);
  const errors = state.fieldErrors ?? {};
  const admin = template.kind === "admin";

  return (
    <WorkbenchPanel
      title={template.name}
      description={t("version", { version: template.version })}
      footer={
        <>
          {admin ? null : (
            <DeleteTemplateButton
              template={template}
              deleteAction={deleteAction}
            />
          )}
          <Button
            type="submit"
            form={FORM_ID}
            disabled={pending}
            data-testid="save-template"
          >
            {t("form.save")}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        action={action}
        className="space-y-4"
        data-testid="template-editor"
      >
        <input type="hidden" name="templateId" value={template.id} />
        {template.configValid ? null : (
          <p className="text-12 text-destructive" role="alert">
            {t("form.invalidStored")}
          </p>
        )}
        <MetaFields
          name={template.name}
          description={template.description}
          segment={template.segment}
          errors={errors}
        />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="template-published" className="text-12 font-normal">
            {admin ? t("form.publishedAdmin") : publishedLabel}
          </Label>
          <Switch
            id="template-published"
            name="published"
            defaultChecked={template.published}
            disabled={admin}
          />
          {/* A disabled switch is not submitted: the admin template stays on. */}
          {admin ? <input type="hidden" name="published" value="on" /> : null}
        </div>
        <AgentConfigEditor
          initial={template.config}
          editor="template"
          agentKind={agentKindOfTemplate(template.kind)}
          fieldErrors={errors}
        />
      </form>
    </WorkbenchPanel>
  );
}

function DeleteTemplateButton({
  template,
  deleteAction,
}: Readonly<{ template: TemplateDetailDto; deleteAction: FormAction }>) {
  const t = useTranslations("aiConsole.templates.form");
  const tCommon = useTranslations("common");
  const { confirmStatus, showStatus } = useStatus();
  const [pending, startTransition] = useTransition();

  async function onDelete() {
    const confirmed = await confirmStatus({
      title: t("deleteTitle"),
      message: t("deleteMessage", { name: template.name }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("templateId", template.id);
      const result = await deleteAction({}, formData);
      // Success redirects to the list; only an error comes back.
      if (result?.error) {
        showStatus({ type: "down", title: result.error });
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={onDelete}
      data-testid="delete-template"
    >
      {t("delete")}
    </Button>
  );
}
