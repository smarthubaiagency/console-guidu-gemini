"use client";

import Link from "next/link";
import { ShieldAlert, User, ShieldCheck } from "lucide-react";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import type { UserWorkspace } from "@/core/workspaces/navigation";

interface AppHeaderProps {
  currentSlug: string;
  workspaces: UserWorkspace[];
  userEmail?: string | undefined;
  isPlatformAdmin?: boolean;
  appName: string;
}

export function AppHeader({
  currentSlug,
  workspaces,
  userEmail,
  isPlatformAdmin = false,
  appName,
}: AppHeaderProps) {
  return (
    <header className="border-border bg-surface-card flex h-14 shrink-0 items-center justify-between border-b px-6">
      <div className="flex items-center gap-4">
        <Link
          href="/app"
          className="text-16 text-text mr-2 flex items-center gap-2 font-bold tracking-tight"
        >
          <div className="bg-primary text-on-primary text-12 flex h-6 w-6 items-center justify-center rounded-sm font-black">
            {appName.charAt(0).toUpperCase()}
          </div>
          <span>{appName}</span>
        </Link>

        <div className="bg-surface-strong h-4 w-px" />

        <WorkspaceSwitcher currentSlug={currentSlug} workspaces={workspaces} />

        <div className="bg-success-bg text-success-text text-11 border-success-border hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium sm:flex">
          <span className="bg-success-solid h-1.5 w-1.5 animate-pulse rounded-full" />
          <span>Ambiente Ativo</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isPlatformAdmin && (
          <Link
            href="/platform"
            className="text-12 text-warning-text bg-warning-bg hover:bg-warning-border border-warning-border flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition"
          >
            <ShieldAlert className="text-warning-solid h-3.5 w-3.5" />
            <span>Painel Admin</span>
          </Link>
        )}

        <Link
          href="/app/account/security"
          className="text-12 text-text-subtle hover:text-text border-border hover:border-border-strong bg-surface-sidebar flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition"
        >
          <User className="text-text-secondary h-3.5 w-3.5" />
          <span className="max-w-email hidden truncate md:inline">
            {userEmail ?? "Minha Conta"}
          </span>
          <ShieldCheck className="text-success-solid h-3.5 w-3.5" />
        </Link>

        <ThemeToggle />
        <SignOutForm />
      </div>
    </header>
  );
}
