"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { saveBrandAction, type BrandActionState } from "@/core/brand/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BrandAction = (
  prev: BrandActionState,
  formData: FormData,
) => Promise<BrandActionState>;

const INITIAL: BrandActionState = {};

/** Brand editor of the platform console (ADR 0012, P3). */
export function BrandForm({
  defaults,
  hasLogo,
  action: saveAction = saveBrandAction,
}: Readonly<{
  defaults: {
    displayName: string;
    primaryColor: string;
    supportEmail: string;
    supportUrl: string;
  };
  hasLogo: boolean;
  /** Platform (default) or partner console save action. */
  action?: BrandAction;
}>) {
  const t = useTranslations("brand.form");
  const [state, action, pending] = useActionState(saveAction, INITIAL);
  useActionStatus(state);

  return (
    <form action={action} className="space-y-4" data-testid="brand-form">
      <div className="grid gap-2">
        <Label htmlFor="displayName">{t("displayName")}</Label>
        <Input
          id="displayName"
          name="displayName"
          required
          maxLength={60}
          defaultValue={defaults.displayName}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="primaryColor">{t("primaryColor")}</Label>
        <Input
          id="primaryColor"
          name="primaryColor"
          placeholder="#1976d2"
          pattern="#[0-9a-fA-F]{6}"
          defaultValue={defaults.primaryColor}
        />
        <p className="text-11 text-text-tertiary">{t("contrastHint")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="supportEmail">{t("supportEmail")}</Label>
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={defaults.supportEmail}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="supportUrl">{t("supportUrl")}</Label>
          <Input
            id="supportUrl"
            name="supportUrl"
            type="url"
            defaultValue={defaults.supportUrl}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="logo">{t("logo")}</Label>
        <Input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
        />
        {hasLogo ? (
          <Label className="text-12 text-text-subtle font-normal">
            <Checkbox name="removeLogo" />
            {t("removeLogo")}
          </Label>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
