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
  isAiAgentsAvailable?: boolean;
}

export function AppSidebar({
  workspaceSlug,
  isAiAgentsAvailable = false,
}: AppSidebarProps) {
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
    ...(isAiAgentsAvailable
      ? [
          {
            title: "Agentes de IA",
            href: `/app/${workspaceSlug}/ai-agents`,
            icon: Bot,
            badge: "Em breve",
          },
        ]
      : []),
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
    <aside className="border-border bg-surface-sidebar flex min-h-screen w-64 shrink-0 flex-col justify-between border-r">
      <div className="space-y-6 p-4">
        <div>
          <div className="text-11 text-text-tertiary mb-2 px-3 font-semibold tracking-wider uppercase">
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
                  className={`text-12 flex items-center justify-between rounded-lg px-3 py-2 font-medium transition ${
                    isActive
                      ? "bg-surface-card text-text border-border border shadow-xs"
                      : "text-text-subtle hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="text-text-secondary h-4 w-4 shrink-0" />
                    <span>{item.title}</span>
                  </div>
                  {item.badge && (
                    <span className="bg-surface-strong text-10 text-text-subtle rounded-sm px-1.5 py-0.5 font-medium">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="text-11 text-text-tertiary mb-2 px-3 font-semibold tracking-wider uppercase">
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
                  className={`text-12 flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium transition ${
                    isActive
                      ? "bg-surface-card text-text border-border border shadow-xs"
                      : "text-text-subtle hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <Icon className="text-text-secondary h-4 w-4 shrink-0" />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="border-border border-t p-4">
        <div className="text-12 text-text-secondary flex items-center justify-between px-3 py-2">
          <span className="flex items-center gap-2">
            <HelpCircle className="text-text-tertiary h-4 w-4" />
            <span>Documentação</span>
          </span>
          <span className="text-10 bg-surface-strong text-text-subtle rounded-sm px-1.5 py-0.5">
            v1.0
          </span>
        </div>
      </div>
    </aside>
  );
}
