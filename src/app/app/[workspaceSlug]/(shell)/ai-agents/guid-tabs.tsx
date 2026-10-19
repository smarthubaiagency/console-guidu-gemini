"use client";

import { useTranslations } from "next-intl";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * "GUIDS ativos | GUIDS inativos" (GF1): the agents that answer, and the
 * drafts and paused ones. The four factory GUIDS start inactive, until the
 * customer adds the key, tests and turns them on.
 */
export function GuidTabs({
  active,
  inactive,
  activeCount,
  inactiveCount,
}: Readonly<{
  active: React.ReactNode;
  inactive: React.ReactNode;
  activeCount: number;
  inactiveCount: number;
}>) {
  const t = useTranslations("aiAgents.guids.tabs");
  return (
    <Tabs
      defaultValue={
        activeCount === 0 && inactiveCount > 0 ? "inactive" : "active"
      }
      className="gap-4"
    >
      <TabsList variant="segmented" data-testid="guid-tabs">
        <TabsTrigger value="active">
          {t("active", { count: activeCount })}
        </TabsTrigger>
        <TabsTrigger value="inactive">
          {t("inactive", { count: inactiveCount })}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="active">{active}</TabsContent>
      <TabsContent value="inactive">{inactive}</TabsContent>
    </Tabs>
  );
}
