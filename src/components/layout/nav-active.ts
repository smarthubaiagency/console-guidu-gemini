import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

function matches(item: NavItem, pathname: string): boolean {
  if (!item.href) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Id of the most specific item whose route matches the current path
 * (Adendo §8.1: active item by the most specific route).
 */
export function activeNavItemId(
  sections: readonly NavSection[],
  pathname: string,
): string | null {
  let best: { id: string; length: number } | null = null;
  const visit = (item: NavItem) => {
    if (
      matches(item, pathname) &&
      item.href &&
      (!best || item.href.length > best.length)
    ) {
      best = { id: item.id, length: item.href.length };
    }
    item.children.forEach(visit);
  };
  sections.forEach((section) => section.items.forEach(visit));
  return (best as { id: string } | null)?.id ?? null;
}
