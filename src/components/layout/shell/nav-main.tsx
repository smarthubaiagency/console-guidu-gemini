"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

import { NavIcon } from "../nav-icons";

/** Sub-items of an entry; deeper levels are listed under the same entry. */
function descendants(item: NavItem): NavItem[] {
  return item.children.flatMap((child) => [child, ...descendants(child)]);
}

function NavMainItem({
  item,
  activeId,
}: Readonly<{ item: NavItem; activeId: string | null }>) {
  const t = useTranslations("shell");
  // On a phone the drawer closes once a page is picked.
  const { isMobile, setOpenMobile } = useSidebar();
  const closeDrawer = () => {
    if (isMobile) setOpenMobile(false);
  };
  const nested = descendants(item);
  const holdsActive = nested.some((sub) => sub.id === activeId);
  // A settings entry stands alone: its pages are in the submenu card (CF1).
  const subItems = item.hideChildren ? [] : nested;
  const isActive = item.id === activeId || (item.hideChildren && holdsActive);
  const content = (
    <>
      <NavIcon iconKey={item.iconKey} />
      <span>{item.label}</span>
    </>
  );

  return (
    <Collapsible asChild defaultOpen={isActive || holdsActive}>
      <SidebarMenuItem>
        {item.href ? (
          <SidebarMenuButton asChild tooltip={item.label} isActive={isActive}>
            <Link
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={closeDrawer}
            >
              {content}
            </Link>
          </SidebarMenuButton>
        ) : subItems.length > 0 ? (
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip={item.label}>
              {content}
            </SidebarMenuButton>
          </CollapsibleTrigger>
        ) : (
          <SidebarMenuButton tooltip={item.label}>{content}</SidebarMenuButton>
        )}
        {subItems.length > 0 ? (
          <>
            <CollapsibleTrigger asChild>
              <SidebarMenuAction className="data-[state=open]:rotate-90">
                <ChevronRight />
                <span className="sr-only">
                  {t("toggleItem", { item: item.label })}
                </span>
              </SidebarMenuAction>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {subItems.map((sub) => {
                  const subActive = sub.id === activeId;
                  return (
                    <SidebarMenuSubItem key={sub.id}>
                      {sub.href ? (
                        <SidebarMenuSubButton asChild isActive={subActive}>
                          <Link
                            href={sub.href}
                            aria-current={subActive ? "page" : undefined}
                            onClick={closeDrawer}
                          >
                            <span>{sub.label}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      ) : (
                        <SidebarMenuSubButton>
                          <span>{sub.label}</span>
                        </SidebarMenuSubButton>
                      )}
                    </SidebarMenuSubItem>
                  );
                })}
              </SidebarMenuSub>
            </CollapsibleContent>
          </>
        ) : item.badge ? (
          <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
        ) : null}
      </SidebarMenuItem>
    </Collapsible>
  );
}

/**
 * Main navigation of the sidebar-08 block (ADR 0014): one group per section
 * generated on the server, entries with sub-items collapse.
 */
export function NavMain({
  sections,
  activeId,
}: Readonly<{ sections: readonly NavSection[]; activeId: string | null }>) {
  return sections.map((section) => (
    <SidebarGroup key={section.id}>
      <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
      <nav aria-label={section.label}>
        <SidebarMenu>
          {section.items.map((item) => (
            <NavMainItem key={item.id} item={item} activeId={activeId} />
          ))}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  ));
}
