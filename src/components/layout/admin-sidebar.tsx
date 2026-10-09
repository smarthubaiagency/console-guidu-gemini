"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import type { NavSection } from "@/core/module-runtime/navigation";

import { activeNavItemId } from "./nav-active";
import { NavIcon } from "./nav-icons";

interface AdminSidebarProps {
  /** Generated on the server from core entries and the module registry. */
  sections: readonly NavSection[];
}

export function AdminSidebar({ sections }: AdminSidebarProps) {
  const pathname = usePathname();
  const activeId = activeNavItemId(sections, pathname);

  return (
    <aside className="border-border-inverse bg-surface-inverse text-text-inverse flex min-h-screen w-64 shrink-0 flex-col justify-between border-r">
      <div className="space-y-6 p-4">
        <div className="border-border-inverse flex items-center gap-2.5 border-b px-3 py-2">
          <div className="bg-warning-solid text-on-warning text-12 flex h-7 w-7 items-center justify-center rounded-lg font-black">
            A
          </div>
          <div>
            <div className="text-14 text-text-inverse flex items-center gap-1.5 font-bold tracking-tight">
              <span>Admin Console</span>
            </div>
            <div className="text-10 text-warning-solid font-medium">
              Governança & Auditoria
            </div>
          </div>
        </div>

        {sections.map((section) => (
          <div key={section.id}>
            <div className="text-10 text-text-inverse-secondary mb-2 px-3 font-bold tracking-wider uppercase">
              {section.label}
            </div>
            <nav aria-label={section.label}>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const isActive = item.id === activeId;
                  if (!item.href) return null;
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={`text-12 flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium transition ${
                          isActive
                            ? "bg-surface-inverse-hover text-text-inverse font-semibold shadow-xs"
                            : "text-text-inverse-secondary hover:bg-surface-inverse-hover hover:text-text-inverse"
                        }`}
                      >
                        <NavIcon
                          iconKey={item.iconKey}
                          className="text-text-inverse-secondary h-4 w-4 shrink-0"
                        />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        ))}
      </div>

      <div className="border-border-inverse border-t p-4">
        <Link
          href="/app"
          className="text-12 text-text-inverse-secondary hover:text-text-inverse hover:bg-surface-inverse-hover flex items-center gap-2 rounded-lg px-3 py-2 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar ao App de Cliente</span>
        </Link>
      </div>
    </aside>
  );
}
