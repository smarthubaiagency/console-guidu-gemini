"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  setPlatformModuleAvailabilityAction,
  setWorkspaceModuleStatusAction,
  type ModuleActionState,
} from "@/core/module-runtime/actions";

const INITIAL: ModuleActionState = {};

function Feedback({ state }: { state: ModuleActionState }) {
  const t = useTranslations("modules");
  if (state.error) {
    return (
      <p role="alert" className="text-11 text-danger-text">
        {state.error}
        {state.requestId
          ? ` ${t("reference", { id: state.requestId.slice(0, 8) })}`
          : ""}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="text-11 text-success-text">
        {state.message}
      </p>
    );
  }
  return null;
}

/** Enables or disables one module in the workspace. */
export function WorkspaceModuleToggle({
  workspaceSlug,
  moduleKey,
  moduleName,
  enabled,
}: {
  workspaceSlug: string;
  moduleKey: string;
  moduleName: string;
  enabled: boolean;
}) {
  const t = useTranslations("modules");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(
    setWorkspaceModuleStatusAction,
    INITIAL,
  );
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="moduleKey" value={moduleKey} />
      <input
        type="hidden"
        name="status"
        value={enabled ? "disabled" : "enabled"}
      />
      <button
        type="submit"
        disabled={pending}
        aria-label={t(enabled ? "disableModule" : "enableModule", {
          name: moduleName,
        })}
        className={`text-12 rounded-lg border px-3 py-1.5 font-semibold transition disabled:opacity-60 ${
          enabled
            ? "border-border text-text-subtle hover:bg-surface-hover"
            : "bg-primary text-on-primary border-primary"
        }`}
      >
        {pending ? tCommon("saving") : enabled ? t("disable") : t("enable")}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Changes the global availability of one module (admin). */
export function PlatformAvailabilityForm({
  moduleKey,
  moduleName,
  availability,
}: {
  moduleKey: string;
  moduleName: string;
  availability: "enabled" | "maintenance" | "disabled";
}) {
  const t = useTranslations("modules");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(
    setPlatformModuleAvailabilityAction,
    INITIAL,
  );
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="moduleKey" value={moduleKey} />
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`availability-${moduleKey}`}>
          {t("availabilityOf", { name: moduleName })}
        </label>
        <select
          id={`availability-${moduleKey}`}
          name="availability"
          defaultValue={availability}
          className="border-border bg-surface-card text-12 text-text rounded-lg border px-2 py-1.5"
        >
          <option value="enabled">{t("availability.enabled")}</option>
          <option value="maintenance">{t("availability.maintenance")}</option>
          <option value="disabled">{t("availability.disabled")}</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-on-primary text-12 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
        >
          {pending ? tCommon("saving") : t("apply")}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
