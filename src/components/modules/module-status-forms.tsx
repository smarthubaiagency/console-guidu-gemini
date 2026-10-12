"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  setPlatformModuleAvailabilityAction,
  setWorkspaceModuleStatusAction,
  type ModuleActionState,
} from "@/core/module-runtime/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

const INITIAL: ModuleActionState = {};

/** Result of the action in the SmartStatusBanner (ADR 0016). */
function Feedback({ state }: { state: ModuleActionState }) {
  useActionStatus(state);
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
      <Button
        type="submit"
        size="sm"
        variant={enabled ? "outline" : "default"}
        disabled={pending}
        aria-label={t(enabled ? "disableModule" : "enableModule", {
          name: moduleName,
        })}
      >
        {pending ? tCommon("saving") : enabled ? t("disable") : t("enable")}
      </Button>
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
        <Label className="sr-only" htmlFor={`availability-${moduleKey}`}>
          {t("availabilityOf", { name: moduleName })}
        </Label>
        <NativeSelect
          id={`availability-${moduleKey}`}
          name="availability"
          size="sm"
          defaultValue={availability}
        >
          <NativeSelectOption value="enabled">
            {t("availability.enabled")}
          </NativeSelectOption>
          <NativeSelectOption value="maintenance">
            {t("availability.maintenance")}
          </NativeSelectOption>
          <NativeSelectOption value="disabled">
            {t("availability.disabled")}
          </NativeSelectOption>
        </NativeSelect>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? tCommon("saving") : t("apply")}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
