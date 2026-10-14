import { getTranslations } from "next-intl/server";

import { BrandForm } from "@/components/brand/brand-form";
import { SettingsCard } from "@/components/settings/settings-shell";
import type { BrandActionState } from "@/core/brand/actions";
import type { Brand } from "@/core/brand/types";
import { BrandMark } from "@/shared/ui/brand-mark";

type BrandAction = (
  prev: BrandActionState,
  formData: FormData,
) => Promise<BrandActionState>;

/**
 * Body of the Marca settings page (CF2), at the platform and in /admin: the
 * active version and the editor, which saves a new version.
 */
export async function BrandSettings({
  brand,
  status,
  defaultName,
  action,
}: Readonly<{
  brand: Brand;
  /** "Versão N" or the no-brand notice of the level. */
  status: string;
  /** Name suggested while the partner has no version. */
  defaultName: string;
  action?: BrandAction;
}>) {
  const t = await getTranslations("brand");
  return (
    <>
      <SettingsCard title={t("current.title")} testId="brand-current">
        <div className="flex items-center gap-3">
          <BrandMark
            name={brand.name}
            logoUrl={brand.logoUrl}
            logoDarkUrl={brand.logoDarkUrl}
            size="md"
          />
          <div>
            <div
              className="text-14 text-text font-semibold"
              data-testid="brand-current-name"
            >
              {brand.name}
            </div>
            <div className="text-12 text-text-secondary">{status}</div>
          </div>
        </div>
      </SettingsCard>
      <BrandForm
        {...(action ? { action } : {})}
        defaults={{
          displayName: brand.source === "partner" ? brand.name : defaultName,
          primaryColor: brand.primaryColor ?? "",
          supportEmail: brand.supportEmail ?? "",
          supportUrl: brand.supportUrl ?? "",
          tagline: brand.tagline ?? "",
          footerText: brand.footerText ?? "",
          whatsappNumber: brand.whatsapp ? `+${brand.whatsapp.number}` : "",
          whatsappLabel: brand.whatsapp?.label ?? "",
          whatsappMessage: brand.whatsapp?.message ?? "",
        }}
        images={{
          logo: brand.logoUrl,
          logoDark: brand.logoDarkUrl,
          favicon: brand.faviconUrl,
          shareImage: brand.shareImageUrl,
        }}
      />
    </>
  );
}
