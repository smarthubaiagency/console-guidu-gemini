"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import {
  AgentConfigEditor,
  type EditorCredential,
} from "@/components/ai-agents/agent-config-editor";
import { Referrals } from "@/components/ai-agents/referrals";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { useStatus } from "@/components/feedback/status-context";
import { WorkbenchPanel } from "@/components/layout/workbench";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  createGuidAction,
  customizeGuidAction,
  deleteGuidAction,
  deleteReferralAction,
  type GuidActionState,
  saveGuidAction,
  saveReferralAction,
  testGuidKeyAction,
} from "@/modules/ai-agents/server/actions";
import type { GuidDetailDto } from "@/modules/ai-agents/server/services/guid-config";

/**
 * Forms of the GUIDS of the workspace (A4a): a new GUIDS from a template or
 * blank, and the drawer of one GUIDS with its configuration (the customer's
 * division of fields), the key test, customization, deletion and, once
 * customized, the referrals.
 */

const INITIAL: GuidActionState = {};
const FORM_ID = "guid-form";
/** The "Personalizado" option: a GUIDS without a template. */
const CUSTOM = "custom";
const REFERRAL_ACTIONS = {
  save: saveReferralAction,
  delete: deleteReferralAction,
};

export type GuidTemplateOption = Readonly<{
  id: string;
  name: string;
  description: string | null;
}>;

/** "Personalizado" (blank) or one of the published templates. */
export function CreateGuidForm({
  workspaceSlug,
  templates,
}: Readonly<{
  workspaceSlug: string;
  templates: readonly GuidTemplateOption[];
}>) {
  const t = useTranslations("aiAgents.guids");
  const [state, action, pending] = useActionState(createGuidAction, INITIAL);
  useActionStatus(state);
  const options = [
    ...templates,
    { id: CUSTOM, name: t("custom"), description: t("customHint") },
  ];
  return (
    <form action={action} className="space-y-4" data-testid="create-guid">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <p className="text-12 text-text-secondary">{t("chooseTemplate")}</p>
      <RadioGroup
        name="templateId"
        defaultValue={options[0]?.id ?? CUSTOM}
        aria-label={t("chooseTemplate")}
        className="gap-2"
      >
        {options.map((option) => (
          <Label
            key={option.id}
            htmlFor={`guid-template-${option.id}`}
            className="border-card-border flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal"
          >
            <RadioGroupItem
              id={`guid-template-${option.id}`}
              value={option.id}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="text-12 text-text block font-medium">
                {option.name}
              </span>
              {option.description ? (
                <span className="text-11 text-text-secondary block">
                  {option.description}
                </span>
              ) : null}
            </span>
          </Label>
        ))}
      </RadioGroup>
      <Button type="submit" disabled={pending}>
        {t("create")}
      </Button>
    </form>
  );
}

export function GuidPanel({
  workspaceSlug,
  guid,
  canManage,
  testHref,
  credentials,
  summary,
}: Readonly<{
  workspaceSlug: string;
  guid: GuidDetailDto;
  canManage: boolean;
  /** The drawer of "Testar agente". */
  testHref: string;
  credentials: readonly EditorCredential[];
  /** Status, origin, key and missing fields, rendered by the page. */
  summary: React.ReactNode;
}>) {
  const t = useTranslations("aiAgents.guids");
  const [state, action, pending] = useActionState(saveGuidAction, INITIAL);
  useActionStatus(state);
  const testLink = (
    <Button asChild variant="outline" data-testid="open-guid-test">
      <Link href={testHref} scroll={false}>
        {t("test.open")}
      </Link>
    </Button>
  );

  return (
    <WorkbenchPanel
      title={guid.name ?? t("unnamed")}
      footer={
        canManage ? (
          <>
            <DeleteGuidButton workspaceSlug={workspaceSlug} guid={guid} />
            {testLink}
            <GuidButton
              action={testGuidKeyAction}
              fields={{ workspaceSlug, agentId: guid.id }}
              label={t("keyTest.run")}
              testId="test-guid-key"
            />
            <Button
              type="submit"
              form={FORM_ID}
              disabled={pending}
              data-testid="save-guid"
            >
              {t("save")}
            </Button>
          </>
        ) : (
          testLink
        )
      }
    >
      <div className="space-y-6" data-testid="guid-panel">
        {summary}
        {canManage ? (
          <>
            {guid.customized ? null : (
              <CustomizeGuid workspaceSlug={workspaceSlug} guid={guid} />
            )}
            <form
              id={FORM_ID}
              action={action}
              className="space-y-4"
              data-testid="guid-form"
            >
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <input type="hidden" name="agentId" value={guid.id} />
              {guid.configValid ? null : (
                <p className="text-12 text-destructive" role="alert">
                  {t("invalidStored")}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="guid-active" className="text-12 font-normal">
                  {t("active")}
                </Label>
                <Switch
                  id="guid-active"
                  name="active"
                  defaultChecked={guid.status === "active"}
                  aria-invalid={state.fieldErrors?.active ? true : undefined}
                  aria-describedby={
                    state.fieldErrors?.active ? "guid-active-error" : undefined
                  }
                />
              </div>
              {state.fieldErrors?.active ? (
                <p
                  id="guid-active-error"
                  className="text-12 text-destructive"
                  role="alert"
                >
                  {state.fieldErrors.active}
                </p>
              ) : null}
              {credentials.length === 0 ? (
                <p className="text-11 text-text-secondary">{t("noKeys")}</p>
              ) : null}
              <AgentConfigEditor
                initial={guid.config}
                editor={guid.editor}
                agentKind="guid"
                fieldErrors={state.fieldErrors}
                credentials={credentials}
              />
            </form>
            {guid.customized ? (
              <Referrals
                agentId={guid.id}
                referrals={guid.referrals}
                canManage
                actions={REFERRAL_ACTIONS}
                hidden={{ workspaceSlug }}
              />
            ) : null}
          </>
        ) : (
          <p className="text-12 text-text-secondary">{t("readOnly")}</p>
        )}
      </div>
    </WorkbenchPanel>
  );
}

/** One click that sends a few fields to an action, without a form. */
function GuidButton({
  action,
  fields,
  label,
  testId,
}: Readonly<{
  action: (
    prev: GuidActionState,
    formData: FormData,
  ) => Promise<GuidActionState>;
  fields: Readonly<Record<string, string>>;
  label: string;
  testId: string;
}>) {
  const [state, setState] = useState<GuidActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      data-testid={testId}
      onClick={() =>
        startTransition(async () => {
          const formData = new FormData();
          for (const [name, value] of Object.entries(fields)) {
            formData.append(name, value);
          }
          setState(await action({}, formData));
        })
      }
    >
      {label}
    </Button>
  );
}

function CustomizeGuid({
  workspaceSlug,
  guid,
}: Readonly<{ workspaceSlug: string; guid: GuidDetailDto }>) {
  const t = useTranslations("aiAgents.guids");
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  const [state, setState] = useState<GuidActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);

  async function onCustomize() {
    const confirmed = await confirmStatus({
      title: t("customizeTitle"),
      message: t("customizeMessage"),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("customize"),
      cancelLabel: t("cancel"),
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("agentId", guid.id);
      setState(await customizeGuidAction({}, formData));
    });
  }

  return (
    <div className="border-card-border flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
      <p className="text-12 text-text-secondary">{t("customizeHint")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={onCustomize}
        data-testid="customize-guid"
      >
        {t("customize")}
      </Button>
    </div>
  );
}

function DeleteGuidButton({
  workspaceSlug,
  guid,
}: Readonly<{ workspaceSlug: string; guid: GuidDetailDto }>) {
  const t = useTranslations("aiAgents.guids");
  const tCommon = useTranslations("common");
  const { confirmStatus, showStatus } = useStatus();
  const [pending, startTransition] = useTransition();

  async function onDelete() {
    const confirmed = await confirmStatus({
      title: t("deleteTitle"),
      message: t("deleteMessage", { name: guid.name ?? t("unnamed") }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("agentId", guid.id);
      const result = await deleteGuidAction({}, formData);
      // Success redirects to the list; only an error comes back.
      if (result?.error) showStatus({ type: "down", title: result.error });
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={onDelete}
      data-testid="delete-guid"
    >
      {t("delete")}
    </Button>
  );
}
