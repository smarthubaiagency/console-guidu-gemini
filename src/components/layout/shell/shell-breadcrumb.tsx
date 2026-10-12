"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

import { activeNavItemId } from "../nav-active";

export type Crumb = Readonly<{ label: string; href: string | null }>;

/** Section, parent entries and the active entry of the current page. */
export function breadcrumbTrail(
  sections: readonly NavSection[],
  activeId: string | null,
): Crumb[] {
  if (!activeId) return [];
  const find = (items: readonly NavItem[], path: NavItem[]): NavItem[] => {
    for (const item of items) {
      if (item.id === activeId) return [...path, item];
      const found = find(item.children, [...path, item]);
      if (found.length > 0) return found;
    }
    return [];
  };
  for (const section of sections) {
    const path = find(section.items, []);
    if (path.length > 0) {
      return [
        { label: section.label, href: null },
        ...path.map((item) => ({ label: item.label, href: item.href })),
      ];
    }
  }
  return [];
}

/** Breadcrumb of the sidebar-08 content header (ADR 0014). */
export function ShellBreadcrumb({
  sections,
}: Readonly<{ sections: readonly NavSection[] }>) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const trail = breadcrumbTrail(sections, activeNavItemId(sections, pathname));
  if (trail.length === 0) return null;
  const last = trail.length - 1;

  return (
    <Breadcrumb aria-label={t("breadcrumb")}>
      <BreadcrumbList>
        {trail.map((crumb, index) => (
          <Fragment key={`${index}-${crumb.label}`}>
            {index > 0 ? (
              <BreadcrumbSeparator className="hidden md:block" />
            ) : null}
            <BreadcrumbItem
              className={index === last ? undefined : "hidden md:block"}
            >
              {index === last ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : crumb.href ? (
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <span>{crumb.label}</span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
