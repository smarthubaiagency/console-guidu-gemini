"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  createPlatformKeyAction,
  type PlatformKeyActionState,
  revokePlatformKeyAction,
} from "@/core/platform-api/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";

const INITIAL: PlatformKeyActionState = {};
const INPUT =
  "border-border bg-surface-card text-12 text-text w-full rounded-lg border px-3 py-2";
const LABEL = "text-12 text-text-subtle flex flex-col gap-1 font-medium";

/** Result in the SmartStatusBanner (ADR 0016); the new key stays here, to copy. */
function Feedback({ state }: Readonly<{ state: PlatformKeyActionState }>) {
  useActionStatus(state);
  if (!state.rawKey) return null;
  return (
    <code
      className="bg-surface-raised text-11 block rounded-sm px-2 py-1 break-all select-all"
      data-testid="platform-raw-key"
    >
      {state.rawKey}
    </code>
  );
}

/** Creation form of an administrative key (F4e). */
export function CreatePlatformKeyForm({
  scopes,
}: Readonly<{
  scopes: readonly Readonly<{ id: string; label: string; desc: string }>[];
}>) {
  const t = useTranslations("platformKeys.form");
  const [state, action, pending] = useActionState(
    createPlatformKeyAction,
    INITIAL,
  );
  return (
    <form
      action={action}
      className="space-y-3"
      data-testid="create-platform-key"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          {t("name")}
          <input name="name" required maxLength={80} className={INPUT} />
        </label>
        <label className={LABEL}>
          {t("expiresInDays")}
          <input
            name="expiresInDays"
            type="number"
            min={1}
            max={90}
            defaultValue={30}
            className={INPUT}
          />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-12 text-text-subtle font-medium">
          {t("scopes")}
        </legend>
        {scopes.map((scope) => (
          <label key={scope.id} className="text-12 text-text flex gap-2">
            <input type="checkbox" name="scopes" value={scope.id} />
            <span>
              <span className="font-medium">{scope.label}</span>
              <span className="text-text-secondary block">{scope.desc}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-on-primary text-12 rounded-lg px-3 py-2 font-semibold disabled:opacity-60"
      >
        {t("create")}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function RevokePlatformKeyButton({
  keyId,
}: Readonly<{ keyId: string }>) {
  const t = useTranslations("platformKeys.form");
  const [state, action, pending] = useActionState(
    revokePlatformKeyAction,
    INITIAL,
  );
  useActionStatus(state);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="keyId" value={keyId} />
      <button
        type="submit"
        disabled={pending}
        className="border-border text-text-subtle hover:bg-surface-hover text-12 rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-60"
      >
        {t("revoke")}
      </button>
    </form>
  );
}
