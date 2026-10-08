"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Layers,
  Users,
  ArrowLeft,
  LayoutDashboard,
} from "lucide-react";

export function AdminSidebar() {
  const pathname = usePathname();

  const navItems = [
    {
      title: "Visão Geral",
      href: "/admin",
      icon: LayoutDashboard,
      exact: true,
    },
    {
      title: "Clientes / Empresas",
      href: "/admin/customers",
      icon: Building2,
    },
    {
      title: "Workspaces",
      href: "/admin/workspaces",
      icon: Layers,
    },
    {
      title: "Usuários da Plataforma",
      href: "/admin/users",
      icon: Users,
    },
  ];

  return (
    <aside className="w-64 border-r border-neutral-200 bg-neutral-900 text-white flex flex-col justify-between shrink-0 min-h-screen">
      <div className="p-4 space-y-6">
        <div className="flex items-center gap-2.5 px-3 py-2 border-b border-neutral-800">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-neutral-950 font-black text-xs">
            A
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
              <span>Admin Console</span>
            </div>
            <div className="text-[10px] text-amber-400 font-medium">
              Governança & Auditoria
            </div>
          </div>
        </div>

        <div>
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Administração
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                    isActive
                      ? "bg-neutral-800 text-white shadow-xs font-semibold"
                      : "text-neutral-400 hover:bg-neutral-800/60 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-neutral-800">
        <Link
          href="/app"
          className="flex items-center gap-2 text-xs text-neutral-400 hover:text-white px-3 py-2 rounded-lg hover:bg-neutral-800 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar ao App de Cliente</span>
        </Link>
      </div>
    </aside>
  );
}
