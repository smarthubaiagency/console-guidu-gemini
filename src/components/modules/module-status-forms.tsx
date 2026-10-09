"use client";

import { useActionState } from "react";

import {
  setPlatformModuleAvailabilityAction,
  setWorkspaceModuleStatusAction,
  type ModuleActionState,
} from "@/core/module-runtime/actions";

const INITIAL: ModuleActionState = {};

function Feedback({ state }: { state: ModuleActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-11 text-danger-text">
        {state.error}
        {state.requestId ? ` (ref. ${state.requestId.slice(0, 8)})` : ""}
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
        aria-label={`${enabled ? "Desabilitar" : "Habilitar"} ${moduleName}`}
        className={`text-12 rounded-lg border px-3 py-1.5 font-semibold transition disabled:opacity-60 ${
          enabled
            ? "border-border text-text-subtle hover:bg-surface-hover"
            : "bg-primary text-on-primary border-primary"
        }`}
      >
        {pending ? "Salvando..." : enabled ? "Desabilitar" : "Habilitar"}
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
  const [state, action, pending] = useActionState(
    setPlatformModuleAvailabilityAction,
    INITIAL,
  );
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="moduleKey" value={moduleKey} />
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`availability-${moduleKey}`}>
          Disponibilidade de {moduleName}
        </label>
        <select
          id={`availability-${moduleKey}`}
          name="availability"
          defaultValue={availability}
          className="border-border bg-surface-card text-12 text-text rounded-lg border px-2 py-1.5"
        >
          <option value="enabled">Disponível</option>
          <option value="maintenance">Manutenção</option>
          <option value="disabled">Desativado para clientes</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-on-primary text-12 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
        >
          {pending ? "Salvando..." : "Aplicar"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
