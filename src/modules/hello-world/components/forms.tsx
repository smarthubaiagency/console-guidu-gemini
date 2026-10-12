"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  createHelloWorldRecordAction,
  saveHelloWorldAdminSettingsAction,
  saveHelloWorldWorkspaceSettingsAction,
  type HelloWorldActionState,
} from "../server/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: HelloWorldActionState = {};

/** Result of the action in the SmartStatusBanner (ADR 0016). */
function Feedback({ state }: { state: HelloWorldActionState }) {
  useActionStatus(state);
  return null;
}

export function CreateRecordForm({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations("helloWorld");
  const [state, action, pending] = useActionState(
    createHelloWorldRecordAction,
    INITIAL,
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <Label htmlFor="hello-title">{t("form.recordTitle")}</Label>
      <Input
        id="hello-title"
        name="title"
        required
        maxLength={120}
        placeholder={t("form.recordTitlePlaceholder")}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("form.creating") : t("form.create")}
        </Button>
        {/* F3a reference job: the same creation through the worker. */}
        <Button
          type="submit"
          name="mode"
          value="background"
          variant="outline"
          disabled={pending}
        >
          {t("form.background")}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function WorkspaceGreetingForm({
  workspaceSlug,
  greeting,
  inheritedGreeting,
  canWrite,
}: {
  workspaceSlug: string;
  greeting: string;
  inheritedGreeting: string;
  canWrite: boolean;
}) {
  const t = useTranslations("helloWorld");
  const [state, action, pending] = useActionState(
    saveHelloWorldWorkspaceSettingsAction,
    INITIAL,
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <Label htmlFor="hello-greeting">{t("form.workspaceGreeting")}</Label>
      <Input
        id="hello-greeting"
        name="greeting"
        maxLength={80}
        defaultValue={greeting}
        placeholder={t("form.inheritedPlaceholder", {
          greeting: inheritedGreeting,
        })}
        disabled={!canWrite}
      />
      <p className="text-11 text-text-tertiary">{t("form.inheritHint")}</p>
      {canWrite ? (
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : t("form.save")}
        </Button>
      ) : (
        <p className="text-12 text-text-secondary">{t("form.viewOnly")}</p>
      )}
      <Feedback state={state} />
    </form>
  );
}

export function AdminGreetingForm({
  defaultGreeting,
  fallback,
  canWrite,
}: {
  defaultGreeting: string;
  fallback: string;
  canWrite: boolean;
}) {
  const t = useTranslations("helloWorld");
  const [state, action, pending] = useActionState(
    saveHelloWorldAdminSettingsAction,
    INITIAL,
  );
  return (
    <form action={action} className="space-y-3">
      <Label htmlFor="hello-default-greeting">{t("form.globalGreeting")}</Label>
      <Input
        id="hello-default-greeting"
        name="defaultGreeting"
        maxLength={80}
        defaultValue={defaultGreeting}
        placeholder={t("form.fallbackPlaceholder", { greeting: fallback })}
        disabled={!canWrite}
      />
      {canWrite ? (
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : t("form.savePolicy")}
        </Button>
      ) : (
        <p className="text-12 text-text-secondary">
          {t("form.platformReadOnly")}
        </p>
      )}
      <Feedback state={state} />
    </form>
  );
}
