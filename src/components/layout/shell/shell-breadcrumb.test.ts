import { describe, expect, it } from "vitest";

import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

import { breadcrumbTrail } from "./shell-breadcrumb";

function item(
  id: string,
  href: string | null,
  children: NavItem[] = [],
): NavItem {
  return {
    id,
    label: id.toUpperCase(),
    href,
    iconKey: null,
    badge: null,
    exact: false,
    children,
    hideChildren: false,
  };
}

const sections: NavSection[] = [
  { id: "core", label: "Core", items: [item("home", "/app/ws")] },
  {
    id: "modules",
    label: "Modules",
    items: [
      item("hello", null, [
        item("greeting", "/app/ws/hello/greeting"),
        item("records", "/app/ws/hello/records"),
      ]),
    ],
  },
];

describe("breadcrumbTrail", () => {
  it("lists the section and the active top entry", () => {
    expect(breadcrumbTrail(sections, "home")).toEqual([
      { label: "Core", href: null },
      { label: "HOME", href: "/app/ws" },
    ]);
  });

  it("includes the parent of a sub-entry", () => {
    expect(breadcrumbTrail(sections, "records")).toEqual([
      { label: "Modules", href: null },
      { label: "HELLO", href: null },
      { label: "RECORDS", href: "/app/ws/hello/records" },
    ]);
  });

  it("is empty when nothing is active", () => {
    expect(breadcrumbTrail(sections, null)).toEqual([]);
    expect(breadcrumbTrail(sections, "missing")).toEqual([]);
  });
});
