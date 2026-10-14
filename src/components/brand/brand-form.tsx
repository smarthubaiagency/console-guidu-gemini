"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { saveBrandAction, type BrandActionState } from "@/core/brand/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  brandCss,
  deriveBrandPalette,
  normalizeHexColor,
} from "@/core/brand/tokens";
import { BrandMark } from "@/shared/ui/brand-mark";
import { BrandFooterText, BrandWhatsappLink } from "@/shared/ui/brand-contact";

type BrandAction = (
  prev: BrandActionState,
  formData: FormData,
) => Promise<BrandActionState>;

export type BrandFormDefaults = Readonly<{
  displayName: string;
  primaryColor: string;
  supportEmail: string;
  supportUrl: string;
  tagline: string;
  footerText: string;
  whatsappNumber: string;
  whatsappLabel: string;
  whatsappMessage: string;
}>;

/** Same-origin paths of the current images, or null when not set. */
export type BrandFormImages = Readonly<{
  logo: string | null;
  logoDark: string | null;
  favicon: string | null;
  shareImage: string | null;
}>;

const INITIAL: BrandActionState = {};

function ImageField({
  id,
  label,
  hint,
  accept,
  current,
  removeName,
  removeLabel,
  currentLabel,
}: Readonly<{
  id: string;
  label: string;
  hint?: string;
  accept: string;
  current: string | null;
  removeName: string;
  removeLabel: string;
  currentLabel: string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        {current ? (
          <Image
            src={current}
            alt={currentLabel}
            width={40}
            height={40}
            unoptimized
            className="border-card-border bg-surface size-10 shrink-0 rounded-md border object-contain"
            data-testid={`brand-current-${id}`}
          />
        ) : null}
        <Input id={id} name={id} type="file" accept={accept} />
      </div>
      {hint ? <p className="text-11 text-text-tertiary">{hint}</p> : null}
      {current ? (
        <Label className="text-12 text-text-subtle font-normal">
          <Checkbox name={removeName} />
          {removeLabel}
        </Label>
      ) : null}
    </div>
  );
}

/**
 * Brand editor of the platform and partner consoles (ADR 0012, P3; CF2).
 * One form saves a new version with every field; the cards only group them.
 * The preview follows the typed values before saving.
 */
export function BrandForm({
  defaults,
  images,
  action: saveAction = saveBrandAction,
}: Readonly<{
  defaults: BrandFormDefaults;
  images: BrandFormImages;
  /** Platform (default) or partner console save action. */
  action?: BrandAction;
}>) {
  const t = useTranslations("brand.form");
  const [state, action, pending] = useActionState(saveAction, INITIAL);
  useActionStatus(state);

  const [name, setName] = useState(defaults.displayName);
  const [color, setColor] = useState(defaults.primaryColor);
  const [tagline, setTagline] = useState(defaults.tagline);
  const [footer, setFooter] = useState(defaults.footerText);
  const [whatsappNumber, setWhatsappNumber] = useState(defaults.whatsappNumber);
  const [whatsappLabel, setWhatsappLabel] = useState(defaults.whatsappLabel);

  const previewColor = normalizeHexColor(color);
  const previewDigits = whatsappNumber.replace(/\D/g, "");

  return (
    <form action={action} className="space-y-6" data-testid="brand-form">
      <SettingsCard
        title={t("sections.identity")}
        description={t("sections.identityHint")}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="displayName">{t("displayName")}</Label>
            <Input
              id="displayName"
              name="displayName"
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tagline">{t("tagline")}</Label>
            <Input
              id="tagline"
              name="tagline"
              maxLength={120}
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="primaryColor">{t("primaryColor")}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                aria-label={t("colorPicker")}
                value={previewColor ?? "#000000"}
                onChange={(event) => setColor(event.target.value)}
                className="size-9 shrink-0 cursor-pointer p-1"
              />
              <Input
                id="primaryColor"
                name="primaryColor"
                placeholder="#1976d2"
                pattern="#[0-9a-fA-F]{6}"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
            </div>
            <p className="text-11 text-text-tertiary">{t("contrastHint")}</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("sections.images")}
        description={t("sections.imagesHint")}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ImageField
            id="logo"
            label={t("logo")}
            accept="image/png,image/jpeg,image/webp"
            current={images.logo}
            removeName="removeLogo"
            removeLabel={t("removeLogo")}
            currentLabel={t("current")}
          />
          <ImageField
            id="logoDark"
            label={t("logoDark")}
            hint={t("logoDarkHint")}
            accept="image/png,image/jpeg,image/webp"
            current={images.logoDark}
            removeName="removeLogoDark"
            removeLabel={t("removeLogoDark")}
            currentLabel={t("current")}
          />
          <ImageField
            id="favicon"
            label={t("favicon")}
            accept="image/png,image/x-icon,image/vnd.microsoft.icon,.ico"
            current={images.favicon}
            removeName="removeFavicon"
            removeLabel={t("removeFavicon")}
            currentLabel={t("current")}
          />
          <ImageField
            id="shareImage"
            label={t("shareImage")}
            hint={t("shareImageHint")}
            accept="image/png,image/jpeg,image/webp"
            current={images.shareImage}
            removeName="removeShareImage"
            removeLabel={t("removeShareImage")}
            currentLabel={t("current")}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("sections.contact")}
        description={t("sections.contactHint")}
      >
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="whatsappNumber">{t("whatsappNumber")}</Label>
              <Input
                id="whatsappNumber"
                name="whatsappNumber"
                type="tel"
                inputMode="tel"
                placeholder="+55 11 99999-9999"
                value={whatsappNumber}
                onChange={(event) => setWhatsappNumber(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="whatsappLabel">{t("whatsappLabel")}</Label>
              <Input
                id="whatsappLabel"
                name="whatsappLabel"
                maxLength={40}
                placeholder={t("whatsappDefaultLabel")}
                value={whatsappLabel}
                onChange={(event) => setWhatsappLabel(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="whatsappMessage">{t("whatsappMessage")}</Label>
            <Input
              id="whatsappMessage"
              name="whatsappMessage"
              maxLength={300}
              defaultValue={defaults.whatsappMessage}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="footerText">{t("footerText")}</Label>
            <Textarea
              id="footerText"
              name="footerText"
              maxLength={500}
              rows={3}
              value={footer}
              onChange={(event) => setFooter(event.target.value)}
            />
            <p className="text-11 text-text-tertiary">{t("footerHint")}</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("sections.preview")}
        description={t("sections.previewHint")}
        testId="brand-preview"
      >
        {previewColor ? (
          <style>
            {brandCss(deriveBrandPalette(previewColor), "data-brand-preview")}
          </style>
        ) : null}
        <div
          data-brand-preview=""
          className="border-card-border bg-surface space-y-4 rounded-lg border p-6"
        >
          <div className="flex items-center gap-2">
            <BrandMark
              name={name || "?"}
              logoUrl={images.logo}
              logoDarkUrl={images.logoDark}
            />
            <p className="text-text-secondary text-14 font-medium">{name}</p>
          </div>
          {tagline ? (
            <p className="text-text-secondary text-14">{tagline}</p>
          ) : null}
          <div className="bg-primary text-on-primary text-14 inline-flex rounded-md px-4 py-2 font-medium">
            {t("previewButton")}
          </div>
          {previewDigits.length >= 8 ? (
            <div>
              <BrandWhatsappLink
                whatsapp={{
                  number: previewDigits,
                  label: whatsappLabel || null,
                  message: null,
                }}
                fallbackLabel={t("whatsappDefaultLabel")}
              />
            </div>
          ) : null}
          {footer.trim() ? <BrandFooterText text={footer} /> : null}
        </div>
      </SettingsCard>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
