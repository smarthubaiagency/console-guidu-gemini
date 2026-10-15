"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { AgentConfigEditor } from "@/components/ai-agents/agent-config-editor";
import { Referrals } from "@/components/ai-agents/referrals";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { WorkbenchPanel } from "@/components/layout/workbench";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type AiConsoleActionState,
  deleteCustomerReferralAction,
  saveCustomerGuidAction,
  saveCustomerReferralAction,
} from "@/core/ai/console-actions";
import type { CustomerGuidDetailDto } from "@/core/ai/customer-guids";
import type { AiPolicy } from "@/core/ai/models";

/**
 * Drawer of a customer's GUIDS in `/admin` (A3c): status and configuration
 * (editor `partner`) and the customer's referrals. Support sees the summary
 * and the referrals without actions.
 */

const INITIAL: AiConsoleActionState = {};
const REFERRAL_ACTIONS = {
  save: saveCustomerReferralAction,
  delete: deleteCustomerReferralAction,
};
const FORM_ID = "guid-form";

export function GuidEditorPanel({
  guid,
  canManage,
  summary,
  policy,
}: Readonly<{
  guid: CustomerGuidDetailDto;
  canManage: boolean;
  /** Providers and models the partner offers (CF6a). */
  policy: AiPolicy;
  /** Status, key, model and missing fields, rendered by the page. */
  summary: React.ReactNode;
}>) {
  const t = useTranslations("aiConsole.guids");
  const [state, action, pending] = useActionState(
    saveCustomerGuidAction,
    INITIAL,
  );
  useActionStatus(state);

  return (
    <WorkbenchPanel
      title={guid.name ?? t("unnamed")}
      description={guid.customerName}
      footer={
        canManage ? (
          <Button
            type="submit"
            form={FORM_ID}
            disabled={pending}
            data-testid="save-guid"
          >
            {t("save")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6" data-testid="guid-panel">
        {summary}
        {canManage ? (
          <form
            id={FORM_ID}
            action={action}
            className="space-y-4"
            data-testid="guid-form"
          >
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
              />
            </div>
            <p className="text-11 text-text-secondary">{t("keyHint")}</p>
            <AgentConfigEditor
              initial={guid.config}
              editor="partner"
              agentKind="guid"
              fieldErrors={state.fieldErrors}
              policy={policy}
            />
          </form>
        ) : (
          <p className="text-12 text-text-secondary">{t("readOnly")}</p>
        )}
        <Referrals
          agentId={guid.id}
          referrals={guid.referrals}
          canManage={canManage}
          actions={REFERRAL_ACTIONS}
        />
      </div>
    </WorkbenchPanel>
  );
}
