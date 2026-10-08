"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingBag,
  Store,
  Bot,
  PlayCircle,
  Users,
  Settings,
  Puzzle,
  KeyRound,
  Code2,
  Gauge,
  HelpCircle,
} from "lucide-react";

interface AppSidebarProps {
  workspaceSlug: string;
}

export function AppSidebar({ workspaceSlug }: AppSidebarProps) {
  const pathname = usePathname();

  const mainNav = [
    {
      title: "Visão Geral",
      href: `/app/${workspaceSlug}`,
      icon: LayoutDashboard,
      badge: null,
      exact: true,
    },
    {
      title: "Catálogo",
      href: `/app/${workspaceSlug}/catalog`,
      icon: ShoppingBag,
      badge: "Em breve",
    },
    {
      title: "Google Meu Negócio",
      href: `/app/${workspaceSlug}/google-business`,
      icon: Store,
      badge: "Em breve",
    },
    {
      title: "Agentes de IA",
      href: `/app/${workspaceSlug}/ai-agents`,
      icon: Bot,
      badge: "Em breve",
    },
    {
      title: "Execuções",
      href: `/app/${workspaceSlug}/executions`,
      icon: PlayCircle,
      badge: "Sem dados",
    },
  ];

  const settingsNav = [
    {
      title: "Equipe & Membros",
      href: `/app/${workspaceSlug}/settings/team`,
      icon: Users,
    },
    {
      title: "Geral",
      href: `/app/${workspaceSlug}/settings/general`,
      icon: Settings,
    },
    {
      title: "Módulos",
      href: `/app/${workspaceSlug}/settings/modules`,
      icon: Puzzle,
    },
    {
      title: "Credenciais BYOK",
      href: `/app/${workspaceSlug}/settings/credentials`,
      icon: KeyRound,
    },
    {
      title: "Chaves de API",
      href: `/app/${workspaceSlug}/settings/api`,
      icon: Code2,
    },
    {
      title: "Consumo & Limites",
      href: `/app/${workspaceSlug}/settings/usage`,
      icon: Gauge,
    },
  ];

  return (
    <aside className="w-64 border-r border-neutral-200 bg-neutral-50/50 flex flex-col justify-between shrink-0 min-h-screen">
      <div className="p-4 space-y-6">
        <div>
          <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Plataforma
          </div>
          <nav className="space-y-1">
            {mainNav.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition ${
                    isActive
                      ? "bg-white text-neutral-900 shadow-xs border border-neutral-200"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-neutral-500" />
                    <span>{item.title}</span>
                  </div>
                  {item.badge && (
                    <span className="rounded-sm bg-neutral-200/60 px-1.5 py-0.5 text-[10px] text-neutral-600 font-medium">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Configurações
          </div>
          <nav className="space-y-1">
            {settingsNav.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                    isActive
                      ? "bg-white text-neutral-900 shadow-xs border border-neutral-200"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-neutral-500" />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-neutral-200">
        <div className="flex items-center justify-between text-xs text-neutral-500 px-3 py-2">
          <span className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-neutral-400" />
            <span>Documentação</span>
          </span>
          <span className="text-[10px] bg-neutral-200 px-1.5 py-0.5 rounded text-neutral-600">
            v1.0
          </span>
        </div>
      </div>
    </aside>
  );
}
