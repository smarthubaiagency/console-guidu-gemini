import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

/**
 * Tabs of IA in /platform (CF6a): Painel, Provedores e modelos, Modelos de
 * agente and Chave reserva. Each tab is a page, so the tabs are links drawn
 * like the shadcn tabs (as in Operações, `operations-tabs.tsx`).
 */

const TABS = [
  { key: "dashboard", href: "/platform/ai" },
  { key: "providers", href: "/platform/ai/providers" },
  { key: "templates", href: "/platform/ai/templates" },
  { key: "backup", href: "/platform/ai/backup" },
] as const;

export async function AiTabs({
  active,
}: Readonly<{ active: (typeof TABS)[number]["key"] }>) {
  const t = await getTranslations("aiConsole.tabs");
  return (
    <nav
      aria-label={t("label")}
      className="bg-muted text-muted-foreground inline-flex h-auto w-fit max-w-full flex-wrap items-center justify-center rounded-lg p-0.75"
      data-testid="ai-tabs"
    >
      {TABS.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            data-state={current ? "active" : "inactive"}
            className={cn(
              "text-foreground/60 hover:text-foreground focus-visible:ring-ring/50 inline-flex h-8 items-center justify-center rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-3 focus-visible:outline-none",
              current &&
                "bg-background text-foreground dark:border-input dark:bg-input/30 shadow-sm",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
