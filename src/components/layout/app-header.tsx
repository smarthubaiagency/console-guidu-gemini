"use client";

import Link from "next/link";
import { ShieldAlert, User, ShieldCheck } from "lucide-react";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import type { UserWorkspace } from "@/core/workspaces/navigation";

interface AppHeaderProps {
  currentSlug: string;
  workspaces: UserWorkspace[];
  userEmail?: string | undefined;
  isPlatformAdmin?: boolean;
}

export function AppHeader({
  currentSlug,
  workspaces,
  userEmail,
  isPlatformAdmin = false,
}: AppHeaderProps) {
  return (
    <header className="h-14 border-b border-neutral-200 bg-white px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <Link href="/app" className="flex items-center gap-2 font-bold text-base tracking-tight text-neutral-900 mr-2">
          <div className="h-6 w-6 rounded bg-neutral-900 text-white flex items-center justify-center text-xs font-black">
            G
          </div>
          <span>GUIDU</span>
        </Link>

        <div className="h-4 w-px bg-neutral-200" />

        <WorkspaceSwitcher
          currentSlug={currentSlug}
          workspaces={workspaces}
        />

        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Ambiente Ativo</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isPlatformAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1.5 rounded-lg transition"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
            <span>Painel Admin</span>
          </Link>
        )}

        <Link
          href="/app/account/security"
          className="flex items-center gap-2 text-xs text-neutral-700 hover:text-neutral-900 border border-neutral-200 hover:border-neutral-300 px-2.5 py-1.5 rounded-lg transition bg-neutral-50/50"
        >
          <User className="h-3.5 w-3.5 text-neutral-500" />
          <span className="hidden md:inline max-w-[140px] truncate">
            {userEmail ?? "Minha Conta"}
          </span>
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        </Link>

        <SignOutForm />
      </div>
    </header>
  );
}
