import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

/**
 * Tabs of Cobrança in /platform (CF7): Visão geral and Gateway, the latter
 * only for platform billing managers (owner and billing). Each tab is a
 * page, drawn like the shadcn tabs (as in IA, `ai-tabs.tsx`).
 */

const TABS = [
  { key: "overview", href: "/platform/billing" },
  { key: "gateway", href: "/platform/billing/gateway" },
] as const;

export async function BillingTabs({
  active,
  showGateway,
}: Readonly<{
  active: (typeof TABS)[number]["key"];
  showGateway: boolean;
}>) {
  const t = await getTranslations("gateway.tabs");
  const tabs = TABS.filter((tab) => tab.key !== "gateway" || showGateway);
  return (
    <nav
      aria-label={t("label")}
      className="bg-muted text-muted-foreground inline-flex h-auto w-fit max-w-full flex-wrap items-center justify-center rounded-lg p-0.75"
      data-testid="billing-tabs"
    >
      {tabs.map((tab) => {
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
