import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

/**
 * Labels of a navigation tree in the request language (I1). The tree is
 * built in Portuguese (`navigation.ts`); each section and item is looked up
 * by id (`nav.sections.<scope>.<id>`, `nav.items.<id>`, dots as `_`). A
 * label without a message keeps the Portuguese text of its manifest.
 * Module entries are looked up in the module catalog (I4) through
 * `moduleLabel`, which returns null for ids no module declares.
 */

type Translator = {
  (key: string): string;
  has(key: string): boolean;
};

const keyOf = (id: string) => id.replace(/\./g, "_");

type ModuleLabel = (id: string) => string | null;

function translateItem(
  item: NavItem,
  t: Translator,
  moduleLabel?: ModuleLabel,
): NavItem {
  const key = `items.${keyOf(item.id)}`;
  return {
    ...item,
    label: t.has(key) ? t(key) : (moduleLabel?.(item.id) ?? item.label),
    children: item.children.map((child) =>
      translateItem(child, t, moduleLabel),
    ),
  };
}

export function translateNavigation(
  sections: readonly NavSection[],
  scope: "app" | "platform" | "partner",
  t: Translator,
  moduleLabel?: ModuleLabel,
): NavSection[] {
  return sections.map((section) => {
    const key = `sections.${scope}.${keyOf(section.id)}`;
    return {
      ...section,
      label: t.has(key) ? t(key) : section.label,
      items: section.items.map((item) => translateItem(item, t, moduleLabel)),
    };
  });
}
