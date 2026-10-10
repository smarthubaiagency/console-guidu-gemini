import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell, ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { getRequestBrand } from "@/core/brand/resolve";

export const metadata: Metadata = { title: "Acesso negado" };

/**
 * State shown when the identity is valid and active but lacks access to the
 * requested resource. It never names the resource: that would confirm another
 * customer's data exists.
 */
export default async function AccessDeniedPage() {
  const brand = await getRequestBrand();
  return (
    <AuthShell
      title="Acesso negado"
      description="Sua conta está ativa, mas não tem permissão para este recurso."
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={
        <div className="flex items-center gap-4">
          <Link href="/app" className="underline">
            Voltar
          </Link>
          <SignOutForm />
        </div>
      }
    >
      <ErrorNotice testId="denied-state">
        Peça acesso a quem administra o ambiente.
      </ErrorNotice>
    </AuthShell>
  );
}
