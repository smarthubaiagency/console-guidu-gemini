import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

/**
 * Labels of a navigation tree in the request language (I1). The tree is
 * built in Portuguese (`navigation.ts`); each section and item is looked up
 * by id (`nav.sections.<scope>.<id>`, `nav.items.<id>`, dots as `_`). A
 * label without a message, such as a module that has not been translated
 * yet, keeps the Portuguese text of its manifest.
 */

type Translator = {
  (key: string): string;
  has(key: string): boolean;
};

const keyOf = (id: string) => id.replace(/\./g, "_");

function translateItem(item: NavItem, t: Translator): NavItem {
  const key = `items.${keyOf(item.id)}`;
  return {
    ...item,
    label: t.has(key) ? t(key) : item.label,
    children: item.children.map((child) => translateItem(child, t)),
  };
}

export function translateNavigation(
  sections: readonly NavSection[],
  scope: "app" | "platform" | "partner",
  t: Translator,
): NavSection[] {
  return sections.map((section) => {
    const key = `sections.${scope}.${keyOf(section.id)}`;
    return {
      ...section,
      label: t.has(key) ? t(key) : section.label,
      items: section.items.map((item) => translateItem(item, t)),
    };
  });
}
