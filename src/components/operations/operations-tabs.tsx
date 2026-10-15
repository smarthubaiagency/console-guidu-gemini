import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

/**
 * Tabs of /platform/operations (CF5c): "Saúde e filas" (health, queues,
 * volume, failures and privacy, F3d) and "Manutenção". Each tab is a page,
 * so the tabs are links drawn like the shadcn tabs (`tabs.tsx` is a client
 * module, so its classes are repeated here rather than imported).
 */

const TABS = [
  { key: "health", href: "/platform/operations" },
  { key: "maintenance", href: "/platform/operations/maintenance" },
] as const;

export async function OperationsTabs({
  active,
}: Readonly<{ active: (typeof TABS)[number]["key"] }>) {
  const t = await getTranslations("maintenance.tabs");
  return (
    <nav
      aria-label={t("label")}
      className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-0.75"
      data-testid="operations-tabs"
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
              "text-foreground/60 hover:text-foreground focus-visible:ring-ring/50 inline-flex h-full items-center justify-center rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-3 focus-visible:outline-none",
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
