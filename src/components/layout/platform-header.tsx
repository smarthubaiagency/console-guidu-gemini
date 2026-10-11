"use client";

import Link from "next/link";
import { Languages, ShieldCheck, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { BrandMark } from "@/shared/ui/brand-mark";

interface PlatformHeaderProps {
  userEmail?: string | undefined;
  adminRole?: string | undefined;
  appName: string;
  logoUrl?: string | null | undefined;
}

export function PlatformHeader({
  userEmail,
  adminRole = "owner",
  appName,
  logoUrl,
}: PlatformHeaderProps) {
  const t = useTranslations("shell");
  return (
    <header className="border-border bg-surface-card flex h-14 shrink-0 items-center justify-between border-b px-6">
      <div className="flex items-center gap-3">
        <BrandMark name={appName} logoUrl={logoUrl} />
        <span className="text-14 text-text font-bold tracking-tight">
          {appName} Admin
        </span>
        <div className="bg-warning-bg text-warning-text text-11 border-warning-border flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold">
          <ShieldCheck className="text-warning-solid h-3.5 w-3.5" />
          <span>{t("mfaSession")}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-12 text-text-subtle bg-surface-raised border-border flex items-center gap-2 rounded-lg border px-2.5 py-1">
          <User className="text-text-tertiary h-3.5 w-3.5" />
          <span data-testid="platform-identity">{userEmail}</span>
          <span className="text-10 bg-surface-strong text-text-subtle rounded-sm px-1.5 py-0.5 font-bold uppercase">
            {adminRole}
          </span>
        </div>
        <Link
          href="/app/account/language"
          aria-label={t("language")}
          title={t("language")}
          className="text-text-subtle hover:text-text border-border hover:border-border-strong bg-surface-sidebar flex items-center rounded-lg border px-2 py-1.5 transition"
        >
          <Languages className="h-3.5 w-3.5" />
        </Link>
        <ThemeToggle />
        <SignOutForm />
      </div>
    </header>
  );
}
