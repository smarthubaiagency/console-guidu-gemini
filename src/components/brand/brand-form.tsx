"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { saveBrandAction, type BrandActionState } from "@/core/brand/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";

type BrandAction = (
  prev: BrandActionState,
  formData: FormData,
) => Promise<BrandActionState>;

const INITIAL: BrandActionState = {};

const field =
  "border-border bg-surface-input text-14 text-text w-full rounded-lg border px-3 py-2";
const label = "text-12 text-text-subtle font-medium";

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
      <div className="space-y-1">
        <label htmlFor="displayName" className={label}>
          {t("displayName")}
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          maxLength={60}
          defaultValue={defaults.displayName}
          className={field}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="primaryColor" className={label}>
          {t("primaryColor")}
        </label>
        <input
          id="primaryColor"
          name="primaryColor"
          placeholder="#1976d2"
          pattern="#[0-9a-fA-F]{6}"
          defaultValue={defaults.primaryColor}
          className={field}
        />
        <p className="text-11 text-text-tertiary">{t("contrastHint")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="supportEmail" className={label}>
            {t("supportEmail")}
          </label>
          <input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={defaults.supportEmail}
            className={field}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="supportUrl" className={label}>
            {t("supportUrl")}
          </label>
          <input
            id="supportUrl"
            name="supportUrl"
            type="url"
            defaultValue={defaults.supportUrl}
            className={field}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="logo" className={label}>
          {t("logo")}
        </label>
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="text-12 text-text-subtle"
        />
        {hasLogo ? (
          <label className="text-12 text-text-subtle flex items-center gap-2">
            <input type="checkbox" name="removeLogo" />
            {t("removeLogo")}
          </label>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-on-primary text-12 rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
        >
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
