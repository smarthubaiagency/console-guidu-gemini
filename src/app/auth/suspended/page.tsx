import type { Metadata } from "next";

import { AuthShell, ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { appConfig } from "@/core/config/app";

export const metadata: Metadata = { title: "Conta suspensa" };

/**
 * State shown when the identity is authenticated but blocked or suspended.
 * No workspace data is loaded here — the account cannot operate.
 */
export default function SuspendedPage() {
  return (
    <AuthShell
      title="Conta suspensa"
      description="Esta identidade está bloqueada e não pode realizar operações."
      appName={appConfig.name}
      footer={<SignOutForm />}
    >
      <ErrorNotice testId="suspended-state">
        Se você acredita que isso é um erro, procure a pessoa responsável pela
        sua empresa ou o suporte da plataforma.
      </ErrorNotice>
    </AuthShell>
  );
}
