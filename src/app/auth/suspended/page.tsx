import type { Metadata } from "next";

import { AuthShell, ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { getRequestBrand } from "@/core/brand/resolve";

export const metadata: Metadata = { title: "Conta suspensa" };

/**
 * State shown when the identity is authenticated but blocked or suspended.
 * No workspace data is loaded here — the account cannot operate.
 */
export default async function SuspendedPage() {
  const brand = await getRequestBrand();
  return (
    <AuthShell
      title="Conta suspensa"
      description="Esta identidade está bloqueada e não pode realizar operações."
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={<SignOutForm />}
    >
      <ErrorNotice testId="suspended-state">
        Se você acredita que isso é um erro, procure a pessoa responsável pela
        sua empresa ou o suporte da plataforma.
      </ErrorNotice>
    </AuthShell>
  );
}
