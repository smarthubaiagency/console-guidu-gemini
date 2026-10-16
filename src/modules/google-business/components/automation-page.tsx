"use client";

import {
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  Loader2,
  MessageCircleQuestion,
  Megaphone,
  ShieldCheck,
  Star,
  Store,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { WorkbenchLayout, WorkbenchPanel } from "@/components/layout/workbench";
import { KeyValueList } from "@/components/patterns/key-value-list";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { SectionHeader } from "@/components/patterns/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { Autonomy, AutomationArea } from "../areas";
import { saveAreaAction } from "../server/actions";
import type { GbTarget } from "../server/target";
import type {
  AreaText,
  AutomationPageData,
  FindingText,
  RunText,
} from "./present";
import { SpecialistChat } from "./specialist-chat";

/**
 * The automation page of a ficha (GB1a), on the model components of ADR
 * 0021: the areas as steps on top ("X de 6 áreas configuradas", which
 * measures configuration), the areas with their switch on the left and, on
 * the right, what the area does, the autonomy, the tips the analyses found
 * and "Preciso saber mais" (the specialist in the drawer) / "Aprovado, pode
 * seguir" (saves and goes to the next area).
 */

const AREA_ICONS: Readonly<
  Record<AutomationArea, ComponentType<{ className?: string }>>
> = {
  reviews: Star,
  defense: ShieldCheck,
  info: FileText,
  hours: Clock,
  posts: Megaphone,
  photos: Camera,
};

const SEVERITY_BADGE = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
} as const;

function Tips({ tips }: Readonly<{ tips: readonly FindingText[] }>) {
  const t = useTranslations("googleBusiness.automation");
  if (tips.length === 0) {
    return (
      <Empty className="bg-surface-inset rounded-inner py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCircle2 />
          </EmptyMedia>
          <EmptyTitle>{t("noTips.title")}</EmptyTitle>
          <EmptyDescription>{t("noTips.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ItemGroup className="gap-2" data-testid="area-tips">
      {tips.map((tip) => (
        <Item key={tip.key} variant="inset" role="listitem">
          <ItemContent className="min-w-0">
            <ItemTitle>{tip.title}</ItemTitle>
            {tip.detail ? (
              <ItemDescription>{tip.detail}</ItemDescription>
            ) : null}
            {tip.current || tip.suggested ? (
              <KeyValueList
                className="mt-2"
                items={[
                  ...(tip.current
                    ? [{ label: t("current"), value: tip.current }]
                    : []),
                  ...(tip.suggested
                    ? [{ label: t("suggested"), value: tip.suggested }]
                    : []),
                ]}
              />
            ) : null}
          </ItemContent>
          <ItemActions>
            <Badge variant={SEVERITY_BADGE[tip.severity]}>
              {t(`severity.${tip.severity}`)}
            </Badge>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

function RunStatus({ status }: Readonly<{ status: RunText["status"] }>) {
  const t = useTranslations("googleBusiness.automation.runStatus");
  const variant =
    status === "done"
      ? "success"
      : status === "failed"
        ? "danger"
        : status === "skipped"
          ? "neutral"
          : "info";
  return <Badge variant={variant}>{t(status)}</Badge>;
}

export function AutomationPage({
  target,
  data,
  initialArea,
}: Readonly<{
  target: GbTarget;
  data: AutomationPageData;
  initialArea: AutomationArea | null;
}>) {
  const t = useTranslations("googleBusiness.automation");
  const ta = useTranslations("googleBusiness.areas");
  const router = useRouter();
  const { showStatus } = useStatus();
  const firstPending =
    data.areas.find((a) => !a.approved)?.area ?? data.areas[0]!.area;
  const [current, setCurrent] = useState<AutomationArea>(
    initialArea ?? firstPending,
  );
  const area = data.areas.find((a) => a.area === current) ?? data.areas[0]!;
  const [autonomy, setAutonomy] = useState<Record<string, Autonomy>>(
    Object.fromEntries(data.areas.map((a) => [a.area, a.autonomy])),
  );
  const [saving, setSaving] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Background analyses: the page refreshes until their results arrive.
  useEffect(() => {
    if (!data.running) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [data.running, router]);

  const chosen = autonomy[area.area] ?? area.autonomy;
  const autoAllowed = data.ceiling === "auto";

  async function save(target_: AreaText, enabled: boolean, approve: boolean) {
    setSaving(true);
    const result = await saveAreaAction(target, data.location.id, {
      area: target_.area,
      enabled,
      autonomy: autonomy[target_.area] ?? target_.autonomy,
      approve,
    });
    setSaving(false);
    if (!result.ok) {
      showStatus({
        type: "down",
        title: t("errors.save"),
        details: result.error,
      });
      return;
    }
    showStatus({
      type: "up",
      title: approve
        ? t("saved.approved", { area: ta(`${target_.area}.name`) })
        : t("saved.toggled", { area: ta(`${target_.area}.name`) }),
      ...(approve && result.reviewed && !data.location.reviewed
        ? { message: t("saved.reviewed") }
        : {}),
    });
    if (approve && result.next) setCurrent(result.next);
    router.refresh();
  }

  const AreaIcon = AREA_ICONS[area.area];

  const main = (
    <PageCanvas>
      <PageTitle
        icon={<Store className="size-6" />}
        title={data.location.name}
        description={[data.location.unitName, data.location.address]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Badge variant={data.location.reviewed ? "success" : "warning"}>
              {data.location.reviewed ? t("reviewed") : t("suggestOnly")}
            </Badge>
            <Button variant="outline" onClick={() => setChatOpen(true)}>
              <MessageCircleQuestion />
              {t("askAgent")}
            </Button>
          </>
        }
      />

      <Card
        variant="panel"
        className="px-4 sm:px-6"
        data-testid="automation-progress"
      >
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-16 text-text font-semibold">
            {t("configured", {
              count: data.configured,
              total: data.totalAreas,
            })}
          </p>
          {data.diagnosis.total > 0 ? (
            <Badge variant="neutral">
              {t("diagnosis", {
                ok: data.diagnosis.ok,
                total: data.diagnosis.total,
              })}
            </Badge>
          ) : null}
          <Badge variant="info">{t("points", { count: data.points })}</Badge>
        </div>
        <ol
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          aria-label={t("areasLabel")}
        >
          {data.areas.map((a, index) => (
            <li key={a.area}>
              <Button
                variant={a.area === current ? "default" : "outline"}
                className="w-full justify-start"
                onClick={() => setCurrent(a.area)}
                aria-current={a.area === current ? "step" : undefined}
              >
                {a.approved ? (
                  <CheckCircle2 />
                ) : (
                  <span aria-hidden>{index + 1}</span>
                )}
                <span className="truncate">{ta(`${a.area}.name`)}</span>
              </Button>
            </li>
          ))}
        </ol>
      </Card>

      {!data.location.reviewed ? (
        <Card variant="inset" className="flex-row items-start gap-3 px-4">
          <Info className="text-info-text mt-0.5 size-4 shrink-0" />
          <p className="text-14 text-text-secondary">{t("lock")}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card variant="surface" className="min-w-0 px-4">
          <CardHeader className="px-0">
            <CardTitle className="text-16">{t("areasTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ItemGroup className="gap-2" data-testid="automation-areas">
              {data.areas.map((a) => {
                const Icon = AREA_ICONS[a.area];
                return (
                  <Item
                    key={a.area}
                    variant={a.area === current ? "card" : "inset"}
                    size="sm"
                    role="listitem"
                    className={cn(a.area === current && "ring-ring/40 ring-2")}
                  >
                    <ItemMedia>
                      <Icon className="text-text-secondary size-4" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <Button
                        variant="link"
                        className="h-auto justify-start p-0"
                        onClick={() => setCurrent(a.area)}
                      >
                        <ItemTitle>{ta(`${a.area}.name`)}</ItemTitle>
                      </Button>
                      <ItemDescription>
                        {a.running
                          ? t("running")
                          : a.approved
                            ? t("approved")
                            : t("pending")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={a.enabled}
                        disabled={!data.canManage || saving}
                        onCheckedChange={(checked) => save(a, checked, false)}
                        aria-label={t("toggle", { area: ta(`${a.area}.name`) })}
                      />
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          </CardContent>
        </Card>

        <Card
          variant="surface"
          className="min-w-0 px-4 sm:px-6 lg:col-span-2"
          data-testid="area-detail"
        >
          <CardHeader className="px-0">
            <div className="flex items-center gap-2">
              <AreaIcon className="text-text-secondary size-5" />
              <CardTitle className="text-18">
                {ta(`${area.area}.name`)}
              </CardTitle>
              {area.running ? (
                <Badge variant="info">
                  <Loader2 className="animate-spin" />
                  {t("running")}
                </Badge>
              ) : null}
            </div>
            <CardDescription>{ta(`${area.area}.description`)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 px-0">
            <section className="flex flex-col gap-3">
              <SectionHeader
                level={3}
                title={t("autonomy.title")}
                description={t("autonomy.description")}
              />
              <RadioGroup
                value={chosen === "auto" ? "auto" : "approval"}
                onValueChange={(value) =>
                  setAutonomy((list) => ({
                    ...list,
                    [area.area]: value as Autonomy,
                  }))
                }
                disabled={!data.canManage}
                className="gap-2"
                aria-label={t("autonomy.title")}
              >
                {(["auto", "approval"] as const).map((value) => (
                  <Label
                    key={value}
                    htmlFor={`autonomy-${value}`}
                    className="block"
                  >
                    <Item variant="card" size="sm">
                      <ItemMedia>
                        <RadioGroupItem
                          id={`autonomy-${value}`}
                          value={value}
                          disabled={value === "auto" && !autoAllowed}
                        />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{t(`autonomy.${value}.title`)}</ItemTitle>
                        <ItemDescription>
                          {value === "auto" && !autoAllowed
                            ? t("autonomy.aboveCeiling")
                            : t(`autonomy.${value}.description`)}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  </Label>
                ))}
              </RadioGroup>
            </section>

            {area.metrics.length > 0 ? (
              <section className="flex flex-col gap-3">
                <SectionHeader level={3} title={t("numbers")} />
                <Card variant="inset" className="px-4">
                  <KeyValueList
                    items={area.metrics.map((m) => ({
                      label: m.label,
                      value: m.value,
                    }))}
                  />
                </Card>
              </section>
            ) : null}

            <section className="flex flex-col gap-3">
              <SectionHeader
                level={3}
                title={t("tips.title")}
                description={t("tips.description")}
              />
              <Tips tips={area.tips} />
            </section>
          </CardContent>
          <CardFooter className="flex-wrap justify-end gap-2 px-0">
            <Button variant="outline" onClick={() => setChatOpen(true)}>
              <MessageCircleQuestion />
              {t("learnMore")}
            </Button>
            {data.canManage ? (
              <Button
                onClick={() => save(area, area.enabled, true)}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}
                {t("approve")}
              </Button>
            ) : null}
          </CardFooter>
        </Card>
      </div>

      {data.insights.length > 0 ? (
        <Card variant="panel" className="px-4 sm:px-6" data-testid="insights">
          <SectionHeader
            title={t("insights.title")}
            description={t("insights.description")}
          />
          <div className="grid gap-4 md:grid-cols-2">
            {data.insights.map((run) => (
              <Card key={run.key} variant="surface" className="px-4">
                <CardHeader className="px-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-16 min-w-0 flex-1 truncate">
                      {run.label}
                    </CardTitle>
                    <RunStatus status={run.status} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 px-0">
                  {run.status === "pending" || run.status === "running" ? (
                    <p className="text-14 text-text-secondary">
                      {t("insights.running")}
                    </p>
                  ) : run.status === "failed" ? (
                    <p className="text-14 text-text-secondary">
                      {t("insights.failed")}
                    </p>
                  ) : (
                    <>
                      {run.metrics.length > 0 ? (
                        <KeyValueList
                          items={run.metrics.map((m) => ({
                            label: m.label,
                            value: m.value,
                          }))}
                        />
                      ) : null}
                      <Tips tips={run.findings} />
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}
    </PageCanvas>
  );

  return (
    <WorkbenchLayout
      main={main}
      panelLabel={t("agent.title")}
      panelOpen={chatOpen}
      onPanelOpenChange={setChatOpen}
      panel={
        <WorkbenchPanel
          title={t("agent.title")}
          description={t("agent.description")}
        >
          <SpecialistChat
            target={target}
            locationId={data.location.id}
            area={current}
          />
        </WorkbenchPanel>
      }
    />
  );
}
