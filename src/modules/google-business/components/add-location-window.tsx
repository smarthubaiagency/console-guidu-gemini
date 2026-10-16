"use client";

import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  Loader2,
  MapPin,
  ShieldCheck,
  Store,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { PageTitle } from "@/components/patterns/page-title";
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
  EmptyContent,
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
import { cn } from "@/lib/utils";

import type { LocationOption } from "../provider/port";
import {
  attachUnitAction,
  finishOnboardingAction,
  prepareLocationAction,
  runStepAction,
  startConnectAction,
} from "../server/actions";
import type { UnitMatch } from "../server/onboarding";
import type { GbTarget } from "../server/target";

/**
 * The "Adicionar local" window (GB1a, especificação §7): full screen over
 * the panel (an exception of its own to ADR 0015, docs/architecture/ui-shell.md),
 * with three screens: Conectar (Google sign-in, one ficha at a time, the
 * permissions that are missing), Ler e analisar (each step marked when it
 * really ends, no fake bar) and Pronto ("Encontramos X pontos para
 * validar"), which opens the automation page of the ficha.
 */

export type WindowStep =
  "connect" | "permissions" | "denied" | "failed" | "choose";

type Phase = WindowStep | "analyze" | "ready";

type StepState = "pending" | "running" | "done" | "failed" | "waiting";

type Step = Readonly<{ key: string; label: string }>;

const PERMISSIONS = ["manage_profile", "account_identity"] as const;

export function AddLocationWindow({
  target,
  initialStep,
  missing,
  options,
  configured,
  analysisSteps,
  closeHref,
  workspaceName,
}: Readonly<{
  target: GbTarget;
  initialStep: WindowStep;
  missing: readonly string[];
  /** Fichas of the connected account (null: the connection expired). */
  options: readonly LocationOption[] | null;
  configured: boolean;
  /** Blocking analyses, with their labels already translated. */
  analysisSteps: readonly Step[];
  closeHref: string;
  workspaceName: string;
}>) {
  const t = useTranslations("googleBusiness.window");
  const router = useRouter();
  const { showStatus } = useStatus();
  const headingRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(initialStep);
  const [selected, setSelected] = useState<string>(options?.[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [matches, setMatches] = useState<readonly UnitMatch[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    points: number;
    background: number;
    href: string;
  } | null>(null);

  const steps: Step[] = [
    { key: "read", label: t("steps.read") },
    { key: "unit", label: t("steps.unit") },
    ...analysisSteps,
    { key: "finish", label: t("steps.finish") },
  ];

  const close = useCallback(() => router.push(closeHref), [router, closeHref]);

  useEffect(() => {
    headingRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, close]);

  const mark = (key: string, state: StepState) =>
    setStates((current) => ({ ...current, [key]: state }));

  const failure = (title: string, details?: string) =>
    showStatus({ type: "down", title, ...(details ? { details } : {}) });

  async function connect() {
    setBusy(true);
    const started = await startConnectAction(target);
    if (!started.ok) {
      setBusy(false);
      failure(t("errors.connect"), started.error);
      return;
    }
    window.location.assign(started.url);
  }

  async function runAnalyses(id: string) {
    for (const step of analysisSteps) {
      mark(step.key, "running");
      const run = await runStepAction(target, id, step.key);
      mark(step.key, run.ok && run.status !== "failed" ? "done" : "failed");
    }
    mark("finish", "running");
    const finished = await finishOnboardingAction(target, id);
    if (!finished.ok) {
      mark("finish", "failed");
      setBusy(false);
      failure(t("errors.finish"), finished.error);
      return;
    }
    mark("finish", "done");
    setResult(finished);
    setBusy(false);
    setPhase("ready");
  }

  async function attach(id: string, unitId: string | null) {
    setMatches([]);
    mark("unit", "running");
    const attached = await attachUnitAction(target, id, unitId);
    if (!attached.ok) {
      mark("unit", "failed");
      setBusy(false);
      failure(t("errors.unit"), attached.error);
      return;
    }
    mark("unit", "done");
    await runAnalyses(id);
  }

  async function start() {
    if (!selected) return;
    setBusy(true);
    setPhase("analyze");
    setStates({});
    mark("read", "running");
    const prepared = await prepareLocationAction(target, selected);
    if (!prepared.ok) {
      mark("read", "failed");
      setBusy(false);
      failure(t("errors.read"), prepared.error);
      return;
    }
    mark("read", "done");
    setLocationId(prepared.locationId);
    if (prepared.unitId) {
      mark("unit", "done");
      await runAnalyses(prepared.locationId);
    } else if (prepared.matches.length > 0) {
      mark("unit", "waiting");
      setMatches(prepared.matches);
    } else {
      await attach(prepared.locationId, null);
    }
  }

  const stage = phase === "analyze" ? 2 : phase === "ready" ? 3 : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-location-title"
      data-testid="add-location-window"
      className="bg-surface-canvas fixed inset-0 z-40 overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-start gap-4">
          <div
            ref={headingRef}
            tabIndex={-1}
            id="add-location-title"
            className="min-w-0 flex-1 outline-none"
          >
            <PageTitle
              icon={<Store className="size-6" />}
              title={t("title")}
              description={t("subtitle", { workspace: workspaceName })}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={close}
            disabled={busy}
            aria-label={t("close")}
          >
            <X />
          </Button>
        </div>

        <ol className="grid grid-cols-3 gap-2" aria-label={t("stagesLabel")}>
          {(["connect", "analyze", "ready"] as const).map((key, index) => {
            const number = index + 1;
            const current = number === stage;
            const done = number < stage;
            return (
              <li key={key}>
                <Card
                  variant={current ? "surface" : "inset"}
                  className="flex-row items-center gap-2 px-3 py-3"
                  aria-current={current ? "step" : undefined}
                >
                  {done ? (
                    <CheckCircle2 className="text-success-text size-4 shrink-0" />
                  ) : (
                    <Badge variant={current ? "info" : "neutral"}>
                      {number}
                    </Badge>
                  )}
                  <span
                    className={cn(
                      "text-14 truncate",
                      current
                        ? "text-text font-semibold"
                        : "text-text-secondary",
                    )}
                  >
                    {t(`stages.${key}`)}
                  </span>
                </Card>
              </li>
            );
          })}
        </ol>

        {phase === "connect" ? (
          <Card variant="panel" className="px-6">
            <CardHeader className="px-0">
              <CardTitle className="text-18">{t("connect.title")}</CardTitle>
              <CardDescription>{t("connect.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 px-0">
              <Card variant="inset" className="px-4">
                <ul className="text-14 text-text-secondary flex flex-col gap-2">
                  <li className="flex gap-2">
                    <ShieldCheck className="text-success-text mt-0.5 size-4 shrink-0" />
                    {t("connect.readOnly")}
                  </li>
                  <li className="flex gap-2">
                    <MapPin className="text-text-secondary mt-0.5 size-4 shrink-0" />
                    {t("connect.oneAtATime")}
                  </li>
                </ul>
              </Card>
            </CardContent>
            <CardFooter className="justify-end px-0">
              {configured ? (
                <Button onClick={connect} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  {t("connect.signIn")}
                </Button>
              ) : (
                <p className="text-14 text-text-secondary">
                  {t("connect.notConfigured")}
                </p>
              )}
            </CardFooter>
          </Card>
        ) : null}

        {phase === "permissions" ? (
          <Card
            variant="panel"
            className="px-6"
            data-testid="missing-permissions"
          >
            <CardHeader className="px-0">
              <CardTitle className="text-18">
                {t("permissions.title")}
              </CardTitle>
              <CardDescription>{t("permissions.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-0">
              <ItemGroup className="gap-2">
                {PERMISSIONS.map((permission) => (
                  <Item key={permission} variant="card" role="listitem">
                    <ItemMedia>
                      {missing.includes(permission) ? (
                        <CircleAlert className="text-warning-text size-5" />
                      ) : (
                        <CheckCircle2 className="text-success-text size-5" />
                      )}
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {t(`permissions.items.${permission}.title`)}
                      </ItemTitle>
                      <ItemDescription>
                        {t(`permissions.items.${permission}.why`)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge
                        variant={
                          missing.includes(permission) ? "warning" : "success"
                        }
                      >
                        {missing.includes(permission)
                          ? t("permissions.missing")
                          : t("permissions.granted")}
                      </Badge>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
              <Card variant="inset" className="px-4">
                <p className="text-14 text-text-secondary">
                  {t("permissions.promise")}
                </p>
              </Card>
            </CardContent>
            <CardFooter className="justify-end px-0">
              <Button onClick={connect} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {t("permissions.back")}
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {phase === "denied" || phase === "failed" ? (
          <Card variant="panel" className="px-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleAlert />
                </EmptyMedia>
                <EmptyTitle>{t(`${phase}.title`)}</EmptyTitle>
                <EmptyDescription>{t(`${phase}.description`)}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={connect} disabled={busy || !configured}>
                  {t("retry")}
                </Button>
              </EmptyContent>
            </Empty>
          </Card>
        ) : null}

        {phase === "choose" ? (
          <Card variant="panel" className="px-6">
            <CardHeader className="px-0">
              <CardTitle className="text-18">{t("choose.title")}</CardTitle>
              <CardDescription>{t("choose.description")}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {options && options.length > 0 ? (
                <RadioGroup
                  value={selected}
                  onValueChange={setSelected}
                  aria-label={t("choose.title")}
                  className="gap-2"
                >
                  {options.map((option) => (
                    <Label
                      key={option.id}
                      htmlFor={`ficha-${option.id}`}
                      className="block"
                    >
                      <Item variant="card" size="sm">
                        <ItemMedia>
                          <RadioGroupItem
                            id={`ficha-${option.id}`}
                            value={option.id}
                          />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{option.name}</ItemTitle>
                          <ItemDescription>
                            {[option.category, option.address]
                              .filter(Boolean)
                              .join(" · ")}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    </Label>
                  ))}
                </RadioGroup>
              ) : (
                <Empty className="bg-surface-inset rounded-inner">
                  <EmptyHeader>
                    <EmptyTitle>
                      {options ? t("choose.none") : t("choose.expired")}
                    </EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" onClick={connect} disabled={busy}>
                      {t("retry")}
                    </Button>
                  </EmptyContent>
                </Empty>
              )}
            </CardContent>
            {options && options.length > 0 ? (
              <CardFooter className="justify-end px-0">
                <Button onClick={start} disabled={busy || !selected}>
                  {t("choose.continue")}
                  <ArrowRight />
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        ) : null}

        {phase === "analyze" || phase === "ready" ? (
          <Card variant="panel" className="px-6">
            <CardHeader className="px-0">
              <CardTitle className="text-18">{t("analyze.title")}</CardTitle>
              <CardDescription>{t("analyze.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 px-0">
              <ItemGroup className="gap-2" data-testid="onboarding-steps">
                {steps.map((step) => {
                  const state = states[step.key] ?? "pending";
                  return (
                    <Item
                      key={step.key}
                      variant={state === "pending" ? "inset" : "card"}
                      size="sm"
                      role="listitem"
                      data-state={state}
                    >
                      <ItemMedia>
                        {state === "done" ? (
                          <CheckCircle2 className="text-success-text size-5" />
                        ) : state === "running" ? (
                          <Loader2 className="text-info-text size-5 animate-spin" />
                        ) : state === "failed" ? (
                          <CircleAlert className="text-danger-text size-5" />
                        ) : (
                          <Circle className="text-text-tertiary size-5" />
                        )}
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{step.label}</ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <Badge
                          variant={
                            state === "done"
                              ? "success"
                              : state === "failed"
                                ? "danger"
                                : state === "running" || state === "waiting"
                                  ? "info"
                                  : "neutral"
                          }
                        >
                          {t(`stepState.${state}`)}
                        </Badge>
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>

              {matches.length > 0 && locationId ? (
                <Card
                  variant="surface"
                  className="px-4"
                  data-testid="unit-match"
                >
                  <CardHeader className="px-0">
                    <CardTitle className="text-16">{t("unit.title")}</CardTitle>
                    <CardDescription>{t("unit.description")}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 px-0">
                    {matches.map((match) => (
                      <Item key={match.id} variant="inset" size="sm">
                        <ItemContent className="min-w-0">
                          <ItemTitle>{match.name}</ItemTitle>
                          <ItemDescription>{match.address}</ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Button
                            size="sm"
                            onClick={() => attach(locationId, match.id)}
                          >
                            {t("unit.link", { name: match.name })}
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </CardContent>
                  <CardFooter className="justify-end px-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => attach(locationId, null)}
                    >
                      {t("unit.create")}
                    </Button>
                  </CardFooter>
                </Card>
              ) : null}

              {Object.values(states).includes("failed") && !busy ? (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setPhase("choose")}>
                    {t("retry")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {phase === "ready" && result ? (
          <Card variant="panel" className="px-6" data-testid="onboarding-ready">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CheckCircle2 />
                </EmptyMedia>
                <EmptyTitle>
                  {t("ready.title", { count: result.points })}
                </EmptyTitle>
                <EmptyDescription>
                  {result.background > 0
                    ? t("ready.background")
                    : t("ready.description")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => router.push(result.href)}>
                  {t("ready.open")}
                  <ArrowRight />
                </Button>
              </EmptyContent>
            </Empty>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
