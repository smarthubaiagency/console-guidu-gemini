"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { NavItem, NavSection } from "@/core/module-runtime/navigation";

import { NavIcon } from "../nav-icons";

function pages(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [
    ...(item.href ? [item] : []),
    ...pages(item.children),
  ]);
}

/**
 * Search of the shell header (ADR 0014): the shadcn command menu over the
 * pages of the generated navigation. Opens with Ctrl/⌘+K.
 */
export function ShellSearch({
  sections,
}: Readonly<{ sections: readonly NavSection[] }>) {
  const t = useTranslations("shell");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        data-testid="shell-search"
        aria-label={t("searchTitle")}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hidden h-9 w-full max-w-md justify-start gap-2 font-normal shadow-none md:flex"
      >
        <Search />
        <span className="flex-1 truncate text-left">
          {t("searchPlaceholder")}
        </span>
        <kbd className="bg-muted text-muted-foreground pointer-events-none rounded-sm border px-1.5 font-mono text-xs">
          Ctrl K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={t("searchTitle")}
        onClick={() => setOpen(true)}
      >
        <Search />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("searchTitle")}
        description={t("searchPlaceholder")}
      >
        <CommandInput placeholder={t("searchPlaceholder")} />
        <CommandList>
          <CommandEmpty>{t("searchEmpty")}</CommandEmpty>
          {sections.map((section) => {
            const items = pages(section.items);
            if (items.length === 0) return null;
            return (
              <CommandGroup key={section.id} heading={section.label}>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${section.label} ${item.label} ${item.id}`}
                    onSelect={() => {
                      setOpen(false);
                      if (item.href) router.push(item.href);
                    }}
                  >
                    <NavIcon iconKey={item.iconKey} />
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
