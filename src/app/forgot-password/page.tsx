import type { Metadata } from "next";

import { AuthShell } from "@/shared/ui/auth-shell";
import { appConfig } from "@/core/config/app";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Recuperar senha"
      description="Enviamos um link para você definir uma nova senha."
      appName={appConfig.name}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
