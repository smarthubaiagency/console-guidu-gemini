import Link from "next/link";
import {
  PlayCircle,
  Users,
  Settings,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { loadWorkspaceModuleViews } from "@/core/module-runtime/loaders";
import {
  canOpenWorkspaceAreas,
  resolveModulePageAccess,
} from "@/core/module-runtime/page-access";
import { Permissions } from "@/core/permissions/catalog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { navIcon } from "@/components/layout/nav-icons";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { resolveSeatLimit } from "@/core/entitlements/quotas";
import { moduleStateLabelKey } from "@/core/module-runtime/state";
import { getModuleCatalog } from "@/core/i18n/modules";

export async function generateMetadata() {
  const t = await getTranslations("overview");
  return { title: t("metaTitle") };
}

interface WorkspacePageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { workspaceSlug } = await params;
  const t = await getTranslations("overview");
  const tModules = await getTranslations("modules");
  const catalog = await getModuleCatalog();
  const identity = await requireUserPage(`/app/${workspaceSlug}`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  // The Attendant (AT1) has no workspace.read: its dashboard shows the
  // workspace, its own access and the way into the Inbox (IN4a), never the
  // company's seats, modules or links to areas it cannot open.
  const limited = await withContext(prisma, context, async (tx) => {
    if (await canOpenWorkspaceAreas(tx, context)) return null;
    const [ws, org, inbox] = await Promise.all([
      tx.workspace.findUnique({ where: { id: context.workspaceId } }),
      tx.organization.findUnique({ where: { id: context.organizationId } }),
      resolveModulePageAccess(tx, context, "inbox", Permissions.INBOX_VIEW),
    ]);
    return { workspace: ws, organization: org, inbox: inbox.kind === "ok" };
  });
  if (limited) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="border-border border-b pb-6">
          <div className="text-12 text-text-secondary flex items-center gap-2 font-medium">
            <span>{limited.organization?.name ?? t("organization")}</span>
            <span>•</span>
            <span className="text-success-solid flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("active")}
            </span>
          </div>
          <h1 className="text-24 text-text mt-1 font-bold tracking-tight">
            {limited.workspace?.name ?? workspaceSlug}
          </h1>
        </div>
        <Empty data-testid="attendant-dashboard">
          <EmptyHeader>
            <EmptyTitle>{t("attendantTitle")}</EmptyTitle>
            <EmptyDescription>{t("attendantDescription")}</EmptyDescription>
          </EmptyHeader>
          {limited.inbox ? (
            <EmptyContent>
              <Button asChild>
                <Link href={`/app/${workspaceSlug}/inbox`}>
                  {t("openInbox")}
                </Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    );
  }

  const {
    workspace,
    organization,
    memberCount,
    pendingInvitesCount,
    seatLimit,
  } = await withContext(prisma, context, async (tx) => {
    const [ws, org, members, invites] = await Promise.all([
      tx.workspace.findUnique({
        where: { id: context.workspaceId },
      }),
      tx.organization.findUnique({
        where: { id: context.organizationId },
      }),
      tx.organizationMember.count({
        where: { organizationId: context.organizationId, status: "active" },
      }),
      tx.invitation.count({
        where: { organizationId: context.organizationId, status: "pending" },
      }),
    ]);

    return {
      workspace: ws,
      organization: org,
      memberCount: members,
      pendingInvitesCount: invites,
      // Plan limit (F3b) when the company has one, else max_seats.
      seatLimit: await resolveSeatLimit(
        tx,
        context.organizationId,
        org?.maxSeats ?? 5,
      ),
    };
  });

  // Module cards come from the registry with their resolved state (Adendo §8).
  const { modules: moduleViews } = await loadWorkspaceModuleViews(
    prisma,
    context,
    workspaceSlug,
  );

  const STATE_COLORS: Record<string, string> = {
    enabled: "bg-success-bg text-success-text border-success-border",
    coming_soon: "bg-info-bg text-info-text border-info-border",
    maintenance: "bg-warning-bg text-warning-text border-warning-border",
    not_enabled: "bg-surface-hover text-text-subtle border-border",
  };

  const modules = [
    ...moduleViews.map((view) => ({
      title: catalog.name(view.moduleKey, view.displayName),
      description: catalog.description(view.moduleKey, view.description),
      href:
        view.state === "not_enabled" || !view.href
          ? `/app/${workspaceSlug}/settings/modules`
          : view.href,
      icon: navIcon(view.iconKey),
      status: tModules(
        `states.${moduleStateLabelKey(view.state, view.releaseStatus)}`,
      ),
      statusColor: STATE_COLORS[view.state] ?? STATE_COLORS.not_enabled,
    })),
    {
      title: t("jobsTitle"),
      description: t("jobsDescription"),
      href: `/app/${workspaceSlug}/executions`,
      icon: PlayCircle,
      status: t("noData"),
      statusColor: "bg-surface-hover text-text-subtle border-border",
    },
  ];

  const maxSeats = seatLimit;
  const totalOccupied = memberCount + pendingInvitesCount;
  const seatsPercentage = Math.min(
    Math.round((totalOccupied / maxSeats) * 100),
    100,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Workspace Header */}
      <div className="border-border flex flex-col justify-between gap-4 border-b pb-6 md:flex-row md:items-center">
        <div>
          <div className="text-12 text-text-secondary flex items-center gap-2 font-medium">
            <span>{organization?.name ?? t("organization")}</span>
            <span>•</span>
            <span className="text-success-solid flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("active")}
            </span>
          </div>
          <h1 className="text-24 text-text mt-1 font-bold tracking-tight">
            {workspace?.name ?? workspaceSlug}
          </h1>
          <p className="text-14 text-text-secondary mt-1">{t("subtitle")}</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/app/${workspaceSlug}/settings/team`}
            className="border-border bg-surface-card text-12 text-text-subtle hover:bg-surface-hover flex items-center gap-2 rounded-lg border px-3.5 py-2 font-semibold shadow-xs transition"
          >
            <Users className="text-text-secondary h-4 w-4" />
            <span>{t("manageTeam")}</span>
          </Link>
          <Link
            href={`/app/${workspaceSlug}/settings/general`}
            className="bg-primary text-12 text-on-primary hover:bg-primary-hover flex items-center gap-2 rounded-lg px-3.5 py-2 font-semibold shadow-xs transition"
          >
            <Settings className="h-4 w-4" />
            <span>{t("settings")}</span>
          </Link>
        </div>
      </div>

      {/* Quotas & Capacity Overview */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-12 text-text-secondary font-medium">
              {t("seatsTitle")}
            </span>
            <Users className="text-text-tertiary h-4 w-4" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-24 text-text font-bold">{totalOccupied}</span>
            <span className="text-12 text-text-secondary">
              {t("seatsOf", { max: maxSeats })}
            </span>
          </div>
          <progress
            className={`progress-bar mt-3 ${
              seatsPercentage >= 90 ? "text-warning-solid" : "text-primary"
            }`}
            value={seatsPercentage}
            max={100}
            aria-label={t("seatsOccupied")}
          />
          <p className="text-11 text-text-secondary mt-2">
            {t("seatsDetail", {
              members: memberCount,
              invites: pendingInvitesCount,
            })}
          </p>
        </div>

        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-12 text-text-secondary font-medium">
              {t("isolationTitle")}
            </span>
            <CheckCircle2 className="text-success-solid h-4 w-4" />
          </div>
          <div className="text-18 text-text mt-3 font-bold">
            {t("isolationValue")}
          </div>
          <p className="text-12 text-text-secondary mt-1">
            {t("isolationDescription")}
          </p>
        </div>

        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-12 text-text-secondary font-medium">
              {t("statusTitle")}
            </span>
            <AlertCircle className="text-text-tertiary h-4 w-4" />
          </div>
          <div className="text-18 text-text mt-3 font-bold">
            {t("statusValue")}
          </div>
          <p className="text-12 text-text-secondary mt-1">
            {t("statusDescription")}
          </p>
        </div>
      </div>

      {/* Modules Grid */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-14 text-text-secondary font-semibold tracking-wider uppercase">
            {t("modulesTitle")}
          </h2>
          <span className="text-12 text-text-tertiary">
            {t("modulesSubtitle")}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.title}
                className="border-card-border bg-surface-card hover:border-border-strong flex flex-col justify-between rounded-xl border p-5 shadow-xs transition"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-surface-raised border-border text-text-subtle rounded-lg border p-2.5">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-text text-14 font-semibold">
                          {mod.title}
                        </h3>
                        <span
                          className={`text-10 mt-1 inline-block rounded-full border px-2 py-0.5 font-semibold ${mod.statusColor}`}
                        >
                          {mod.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-12 text-text-secondary mt-3 leading-relaxed">
                    {mod.description}
                  </p>
                </div>

                <div className="border-border mt-4 flex items-center justify-end border-t pt-4">
                  <Link
                    href={mod.href}
                    className="text-12 text-text-subtle hover:text-text flex items-center gap-1 font-medium transition"
                  >
                    <span>{t("access")}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
