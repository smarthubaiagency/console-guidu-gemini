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

const INITIAL: HelloWorldActionState = {};

const INPUT =
  "border-border bg-surface-card text-14 text-text w-full rounded-lg border px-3 py-2 disabled:opacity-60";
const BUTTON =
  "bg-primary text-on-primary text-12 rounded-lg px-4 py-2 font-semibold disabled:opacity-60";

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
      <label
        className="text-12 text-text-subtle block font-medium"
        htmlFor="hello-title"
      >
        {t("form.recordTitle")}
      </label>
      <input
        id="hello-title"
        name="title"
        required
        maxLength={120}
        placeholder={t("form.recordTitlePlaceholder")}
        className={INPUT}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? t("form.creating") : t("form.create")}
        </button>
        {/* F3a reference job: the same creation through the worker. */}
        <button
          type="submit"
          name="mode"
          value="background"
          disabled={pending}
          className="border-border text-text-subtle hover:bg-surface-hover text-12 rounded-lg border px-4 py-2 font-semibold whitespace-nowrap disabled:opacity-60"
        >
          {t("form.background")}
        </button>
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
      <label
        className="text-12 text-text-subtle block font-medium"
        htmlFor="hello-greeting"
      >
        {t("form.workspaceGreeting")}
      </label>
      <input
        id="hello-greeting"
        name="greeting"
        maxLength={80}
        defaultValue={greeting}
        placeholder={t("form.inheritedPlaceholder", {
          greeting: inheritedGreeting,
        })}
        disabled={!canWrite}
        className={INPUT}
      />
      <p className="text-11 text-text-tertiary">{t("form.inheritHint")}</p>
      {canWrite ? (
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? t("form.saving") : t("form.save")}
        </button>
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
      <label
        className="text-12 text-text-subtle block font-medium"
        htmlFor="hello-default-greeting"
      >
        {t("form.globalGreeting")}
      </label>
      <input
        id="hello-default-greeting"
        name="defaultGreeting"
        maxLength={80}
        defaultValue={defaultGreeting}
        placeholder={t("form.fallbackPlaceholder", { greeting: fallback })}
        disabled={!canWrite}
        className={INPUT}
      />
      {canWrite ? (
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? t("form.saving") : t("form.savePolicy")}
        </button>
      ) : (
        <p className="text-12 text-text-secondary">
          {t("form.platformReadOnly")}
        </p>
      )}
      <Feedback state={state} />
    </form>
  );
}
