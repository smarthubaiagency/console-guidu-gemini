import type { Metadata } from "next";
import { Palette } from "lucide-react";

import { BrandForm } from "@/components/brand/brand-form";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { savePartnerBrandAction } from "@/core/brand/actions";
import { getRequestBrand } from "@/core/brand/resolve";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { BrandMark } from "@/shared/ui/brand-mark";

export const metadata: Metadata = { title: "Marca (Parceiro)" };

/** Brand of the partner served on its domains (ADR 0012, P4a). */
export default async function PartnerBrandPage() {
  const { membership } = await requirePartnerConsolePage("/admin/brand");
  if (!partnerGrants(membership.role)("partner.brand.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const brand = await getRequestBrand();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ModulePageHeader
        trail={["Parceiro", "Marca"]}
        title="Marca"
        description="Nome, cor, logo e contatos que os seus clientes veem nos seus domínios."
        icon={<Palette className="h-5 w-5" />}
      />
      <section className="border-card-border bg-surface-card flex items-center gap-3 rounded-xl border p-4 shadow-xs">
        <BrandMark name={brand.name} logoUrl={brand.logoUrl} size="md" />
        <div>
          <div
            className="text-14 text-text font-semibold"
            data-testid="brand-current-name"
          >
            {brand.name}
          </div>
          <div className="text-12 text-text-secondary">
            {brand.source === "partner"
              ? `Versão ${brand.version}`
              : "Ainda sem marca própria: os clientes veem a marca padrão"}
          </div>
        </div>
      </section>
      <section className="border-card-border bg-surface-card rounded-xl border p-6 shadow-xs">
        <BrandForm
          action={savePartnerBrandAction}
          defaults={{
            displayName:
              brand.source === "partner" ? brand.name : membership.partnerName,
            primaryColor: brand.primaryColor ?? "",
            supportEmail: brand.supportEmail ?? "",
            supportUrl: brand.supportUrl ?? "",
          }}
          hasLogo={Boolean(brand.logoUrl)}
        />
      </section>
    </div>
  );
}
