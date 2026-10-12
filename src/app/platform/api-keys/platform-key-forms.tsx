"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  createPlatformKeyAction,
  type PlatformKeyActionState,
  revokePlatformKeyAction,
} from "@/core/platform-api/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: PlatformKeyActionState = {};

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
        <Label className="flex-col items-start">
          {t("name")}
          <Input name="name" required maxLength={80} />
        </Label>
        <Label className="flex-col items-start">
          {t("expiresInDays")}
          <Input
            name="expiresInDays"
            type="number"
            min={1}
            max={90}
            defaultValue={30}
          />
        </Label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-12 text-text-subtle font-medium">
          {t("scopes")}
        </legend>
        {scopes.map((scope) => (
          <Label
            key={scope.id}
            className="text-12 text-text items-start font-normal"
          >
            <Checkbox name="scopes" value={scope.id} />
            <span>
              <span className="font-medium">{scope.label}</span>
              <span className="text-text-secondary block">{scope.desc}</span>
            </span>
          </Label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending}>
        {t("create")}
      </Button>
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
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("revoke")}
      </Button>
    </form>
  );
}
