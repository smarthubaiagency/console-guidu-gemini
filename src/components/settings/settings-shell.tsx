"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem, NavSection } from "@/core/module-runtime/navigation";
import { cn } from "@/lib/utils";

import { activeNavItemId } from "../layout/nav-active";
import { NavIcon } from "../layout/nav-icons";

function SettingsNavItem({
  item,
  activeId,
  depth,
}: Readonly<{ item: NavItem; activeId: string | null; depth: number }>) {
  const active = item.id === activeId;
  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          data-active={active}
          className={cn(
            "text-14 text-text-secondary hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
            active &&
              "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
            depth > 0 && "ml-6",
          )}
        >
          {depth === 0 ? (
            <NavIcon iconKey={item.iconKey} className="size-4 shrink-0" />
          ) : null}
          <span className="truncate">{item.label}</span>
        </Link>
      ) : (
        <span className="text-14 text-text-secondary px-2 py-1.5">
          {item.label}
        </span>
      )}
      {item.children.length > 0 ? (
        <ul className="mt-0.5 space-y-0.5">
          {item.children.map((child) => (
            <SettingsNavItem
              key={child.id}
              item={child}
              activeId={activeId}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Settings page structure (CF1, Marcelo 14/10/2026): the submenu in a card
 * on the left, grouped by section, and the content on the right in cards of
 * its own, using the full width of the main area. On a phone the submenu
 * card comes first.
 */
export function SettingsShell({
  label,
  sections,
  children,
}: Readonly<{
  label: string;
  sections: readonly NavSection[];
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const activeId = activeNavItemId(sections, pathname);
  return (
    <div
      className="flex w-full flex-col gap-4 lg:flex-row lg:items-start lg:gap-6"
      data-testid="settings-shell"
    >
      <nav
        aria-label={label}
        data-testid="settings-nav"
        className="border-card-border bg-surface-card shrink-0 rounded-xl border p-3 shadow-xs lg:sticky lg:top-0 lg:w-64"
      >
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.id} className="space-y-1">
              <p className="text-11 text-text-tertiary px-2 font-medium tracking-wide uppercase">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <SettingsNavItem
                    key={item.id}
                    item={item}
                    activeId={activeId}
                    depth={0}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  );
}

/**
 * A block of a settings page: a card with its title, description and
 * content (usually one form with its own save).
 */
export function SettingsCard({
  title,
  description,
  children,
  testId,
}: Readonly<{
  title: string;
  description?: string;
  children: React.ReactNode;
  testId?: string;
}>) {
  return (
    <section
      className="border-card-border bg-surface-card space-y-4 rounded-xl border p-6 shadow-xs"
      data-testid={testId}
    >
      <div className="space-y-1">
        <h2 className="text-16 text-text font-semibold">{title}</h2>
        {description ? (
          <p className="text-12 text-text-secondary">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
