"use client";

import { useActionState } from "react";

import {
  createHelloWorldRecordAction,
  saveHelloWorldAdminSettingsAction,
  saveHelloWorldWorkspaceSettingsAction,
  type HelloWorldActionState,
} from "../server/actions";

const INITIAL: HelloWorldActionState = {};

const INPUT =
  "border-border bg-surface-card text-14 text-text w-full rounded-lg border px-3 py-2 disabled:opacity-60";
const BUTTON =
  "bg-primary text-on-primary text-12 rounded-lg px-4 py-2 font-semibold disabled:opacity-60";

function Feedback({ state }: { state: HelloWorldActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-12 text-danger-text">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="text-12 text-success-text">
        {state.message}
      </p>
    );
  }
  return null;
}

export function CreateRecordForm({ workspaceSlug }: { workspaceSlug: string }) {
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
        Título do registro
      </label>
      <div className="flex gap-2">
        <input
          id="hello-title"
          name="title"
          required
          maxLength={120}
          placeholder="Ex.: Primeiro registro de exemplo"
          className={INPUT}
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Criando..." : "Criar registro"}
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
        Saudação do workspace
      </label>
      <input
        id="hello-greeting"
        name="greeting"
        maxLength={80}
        defaultValue={greeting}
        placeholder={`Herdada: ${inheritedGreeting}`}
        disabled={!canWrite}
        className={INPUT}
      />
      <p className="text-11 text-text-tertiary">
        Deixe vazio para herdar a saudação global.
      </p>
      {canWrite ? (
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Salvando..." : "Salvar"}
        </button>
      ) : (
        <p className="text-12 text-text-secondary">
          Você pode ver, mas não alterar, esta configuração.
        </p>
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
        Saudação padrão global
      </label>
      <input
        id="hello-default-greeting"
        name="defaultGreeting"
        maxLength={80}
        defaultValue={defaultGreeting}
        placeholder={`Padrão do módulo: ${fallback}`}
        disabled={!canWrite}
        className={INPUT}
      />
      {canWrite ? (
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Salvando..." : "Salvar política"}
        </button>
      ) : (
        <p className="text-12 text-text-secondary">
          Seu papel interno só permite leitura.
        </p>
      )}
      <Feedback state={state} />
    </form>
  );
}
