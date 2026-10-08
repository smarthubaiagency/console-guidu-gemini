"use client";

import { ShieldCheck, User } from "lucide-react";
import { SignOutForm } from "@/shared/ui/sign-out-form";

interface AdminHeaderProps {
  userEmail?: string | undefined;
  adminRole?: string | undefined;
}

export function AdminHeader({ userEmail, adminRole = "owner" }: AdminHeaderProps) {
  return (
    <header className="h-14 border-b border-neutral-200 bg-white px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm tracking-tight text-neutral-900">
          GUIDU Admin
        </span>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-[11px] font-semibold border border-amber-200">
          <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
          <span>Sessão MFA AAL2 Ativa</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-50 px-2.5 py-1 rounded-lg border border-neutral-200">
          <User className="h-3.5 w-3.5 text-neutral-400" />
          <span data-testid="admin-identity">{userEmail}</span>
          <span className="text-[10px] bg-neutral-200 font-bold px-1.5 py-0.5 rounded uppercase text-neutral-700">
            {adminRole}
          </span>
        </div>
        <SignOutForm />
      </div>
    </header>
  );
}
