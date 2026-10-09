"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle } from "lucide-react";

import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

import { activeNavItemId } from "./nav-active";
import { NavIcon } from "./nav-icons";

interface AppSidebarProps {
  /** Generated on the server from core entries and the module registry. */
  sections: readonly NavSection[];
}

function NavLink({
  item,
  activeId,
  nested = false,
}: {
  item: NavItem;
  activeId: string | null;
  nested?: boolean;
}) {
  const isActive = item.id === activeId;
  const content = (
    <>
      <div className="flex items-center gap-2.5">
        <NavIcon
          iconKey={item.iconKey}
          className="text-text-secondary h-4 w-4 shrink-0"
        />
        <span>{item.label}</span>
      </div>
      {item.badge && (
        <span className="bg-surface-strong text-10 text-text-subtle rounded-sm px-1.5 py-0.5 font-medium">
          {item.badge}
        </span>
      )}
    </>
  );
  const className = `text-12 flex items-center justify-between rounded-lg px-3 py-2 font-medium transition ${
    nested ? "ml-4" : ""
  } ${
    isActive
      ? "bg-surface-card text-text border-border border shadow-xs"
      : "text-text-subtle hover:bg-surface-hover hover:text-text"
  }`;

  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          className={className}
          aria-current={isActive ? "page" : undefined}
        >
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
      {item.children.length > 0 && (
        <ul className="mt-1 space-y-1">
          {item.children.map((child) => (
            <NavLink key={child.id} item={child} activeId={activeId} nested />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AppSidebar({ sections }: AppSidebarProps) {
  const pathname = usePathname();
  const activeId = activeNavItemId(sections, pathname);

  return (
    <aside className="border-border bg-surface-sidebar flex min-h-screen w-64 shrink-0 flex-col justify-between border-r">
      <div className="space-y-6 p-4">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="text-11 text-text-tertiary mb-2 px-3 font-semibold tracking-wider uppercase">
              {section.label}
            </div>
            <nav aria-label={section.label}>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <NavLink key={item.id} item={item} activeId={activeId} />
                ))}
              </ul>
            </nav>
          </div>
        ))}
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
