"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  AgentConfigEditor,
  type EditorCredential,
} from "@/components/ai-agents/agent-config-editor";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AssistantDto } from "@/core/ai/assistant-config";
import {
  type AiConsoleActionState,
  savePartnerAssistantAction,
} from "@/core/ai/console-actions";

const INITIAL: AiConsoleActionState = {};

/** Configuration and status of the partner's Assistant. */
export function AssistantForm({
  assistant,
  credentials,
}: Readonly<{
  assistant: AssistantDto;
  credentials: readonly EditorCredential[];
}>) {
  const t = useTranslations("aiConsole.assistant");
  const [state, action, pending] = useActionState(
    savePartnerAssistantAction,
    INITIAL,
  );
  useActionStatus(state);
  return (
    <form action={action} className="space-y-4" data-testid="assistant-form">
      {assistant.configValid ? null : (
        <p className="text-12 text-destructive" role="alert">
          {t("invalidStored")}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="assistant-active" className="text-12 font-normal">
          {t("active")}
        </Label>
        <Switch
          id="assistant-active"
          name="active"
          defaultChecked={assistant.status === "active"}
        />
      </div>
      <AgentConfigEditor
        initial={assistant.config}
        editor="assistant"
        agentKind="assistant"
        fieldErrors={state.fieldErrors}
        credentials={credentials}
      />
      <Button type="submit" disabled={pending} data-testid="save-assistant">
        {t("save")}
      </Button>
    </form>
  );
}
