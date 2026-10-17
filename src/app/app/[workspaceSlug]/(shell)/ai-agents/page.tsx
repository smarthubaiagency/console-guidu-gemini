/**
 * GUIDS of the workspace (A4a, especificação §5.1 and §5.2): the list
 * within the plan limit, a new GUIDS from a published template or blank
 * ("Personalizado"), and the drawer (ADR 0015) at `?edit=<id>` with the
 * customer's division of fields, the key of the workspace's vault, the key
 * test, customization, deletion and the referrals. At
 * `?edit=<id>&view=test` the drawer holds "Testar agente" (A4b). Members
 * with `ai_agents.use` read and test; owner and admin change. With the
 * module flag off, the page says the module is unavailable.
 */

import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Bot, Clock, Plus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { RecordWorkbench, WorkbenchPanel } from "@/components/layout/workbench";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUserPage } from "@/core/auth/page-guard";
import { aiPolicy } from "@/core/ai/catalog";
import { listWorkspaceCredentials } from "@/core/credentials/vault";
import { resolveQuota } from "@/core/entitlements/quotas";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AI_AGENTS_MAX_QUOTA } from "@/modules/ai-agents/manifest";
import {
  type GuidDto,
  listGuids,
  listGuidTemplates,
} from "@/modules/ai-agents/server/services/agents";
import {
  getGuidTestConversation,
  type GuidTestConversationDto,
} from "@/modules/ai-agents/server/services/conversations";
import {
  type GuidChannelsDto,
  listGuidChannels,
} from "@/modules/ai-agents/server/services/channels";
import {
  type GuidDetailDto,
  getGuid,
} from "@/modules/ai-agents/server/services/guid-config";
import {
  type LeadNoticeDto,
  listLeadNotices,
} from "@/modules/ai-agents/server/services/notices";
import { AppError } from "@/shared/errors";

import { GuidChannels } from "./guid-channels";
import { GuidNotices } from "./guid-notices";
import { CreateGuidForm, GuidPanel } from "./guid-forms";
import { GuidTestPanel } from "./guid-test";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

const STATUSES = new Set(["draft", "active", "paused"]);
const KEY_STATES = new Set(["ok", "backup", "failed"]);
const STATUS_BADGE = {
  active: "default",
  paused: "outline",
  draft: "secondary",
} as const;

export async function generateMetadata() {
  const t = await getTranslations("aiAgents");
  return { title: t("metaTitle") };
}

interface AiAgentsPageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ edit?: string; view?: string }>;
}

export default async function AiAgentsPage({
  params,
  searchParams,
}: AiAgentsPageProps) {
  const { workspaceSlug } = await params;
  const base = `/app/${workspaceSlug}/ai-agents`;
  const t = await getTranslations("aiAgents");
  const identity = await requireUserPage(base);
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(context);

  const header = (
    <ModulePageHeader
      title={t("title")}
      description={t("description")}
      icon={<Bot className="h-5 w-5" />}
    />
  );
  if (!isModuleTechnicallyAvailable("ai-agents")) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {header}
        <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
          <div className="bg-info-bg text-info-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
            <Clock className="h-5 w-5" />
          </div>
          <h2 className="text-14 text-text mt-4 font-semibold">
            {t("unavailable.title")}
          </h2>
          <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
            {t("unavailable.body")}
          </p>
        </div>
      </div>
    );
  }

  const { edit, view: drawerView } = await searchParams;
  const editKey = typeof edit === "string" && edit ? edit : null;
  const testing = drawerView === "test";
  const view = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "ai-agents",
      Permissions.AI_AGENTS_USE,
    );
    if (access.kind !== "ok") return access;
    const canManage =
      access.can(Permissions.AI_AGENTS_MANAGE) && !access.readOnly;
    const [guids, templates, quota] = await Promise.all([
      listGuids(tx, context),
      listGuidTemplates(tx, context),
      resolveQuota(tx, context.organizationId, AI_AGENTS_MAX_QUOTA),
    ]);
    let opened: GuidDetailDto | null = null;
    let test: GuidTestConversationDto | null = null;
    let channels: GuidChannelsDto | null = null;
    let notices: LeadNoticeDto[] | null = null;
    if (editKey && editKey !== "new") {
      try {
        opened = await getGuid(tx, context, editKey);
        if (testing) {
          test = await getGuidTestConversation(tx, context, editKey);
        } else {
          channels = await listGuidChannels(tx, context, editKey);
          notices = await listLeadNotices(tx, context, editKey);
        }
      } catch (error) {
        if (!(error instanceof AppError && error.code === "not_found")) {
          throw error;
        }
      }
    }
    // The key pickers: active keys of the vault (text, voice, embeddings).
    const credentials =
      canManage && access.can(Permissions.CREDENTIALS_READ)
        ? (await listWorkspaceCredentials(tx, context)).filter(
            (key) => key.status === "active",
          )
        : [];
    return {
      kind: "ok" as const,
      canManage,
      policy: await aiPolicy(tx),
      guids,
      templates,
      limit: quota.limit,
      opened,
      test,
      channels,
      notices,
      credentials,
    };
  });
  if (view.kind === "missing") notFound();
  if (view.kind !== "ok") {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {header}
        <ModuleNotice variant={view.kind} />
      </div>
    );
  }

  const tConsole = await getTranslations("aiConsole");
  const format = await getFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short" });
  const templateName = new Map(view.templates.map((tpl) => [tpl.id, tpl.name]));
  const canCreate =
    view.canManage && (view.limit === null || view.guids.length < view.limit);

  const details = (guid: GuidDto) =>
    [
      guid.customized
        ? t("guids.customizedLabel")
        : (templateName.get(guid.templateId ?? "") ?? t("guids.fromTemplate")),
      KEY_STATES.has(guid.keyState)
        ? t(`guids.keyState.${guid.keyState}`)
        : null,
      guid.updatedByPartnerName
        ? t("guids.changedByPartner", {
            partner: guid.updatedByPartnerName,
            date: date(guid.updatedAt),
          })
        : t("guids.updated", { date: date(guid.updatedAt) }),
    ]
      .filter(Boolean)
      .join(" · ");
  const statusLabel = (status: string) =>
    STATUSES.has(status) ? t(`guids.status.${status}`) : status;

  let panel: React.ReactNode = null;
  if (editKey === "new" && canCreate) {
    panel = (
      <WorkbenchPanel title={t("guids.new")}>
        <CreateGuidForm
          workspaceSlug={workspaceSlug}
          templates={view.templates}
        />
      </WorkbenchPanel>
    );
  } else if (view.opened && testing) {
    panel = (
      <GuidTestPanel
        key={view.opened.id}
        workspaceSlug={workspaceSlug}
        agentId={view.opened.id}
        title={t("guids.test.title", {
          name: view.opened.name ?? t("guids.unnamed"),
        })}
        backHref={`${base}?edit=${view.opened.id}`}
        initial={view.test}
      />
    );
  } else if (view.opened) {
    const opened = view.opened;
    panel = (
      <GuidPanel
        key={opened.id}
        workspaceSlug={workspaceSlug}
        guid={opened}
        canManage={view.canManage}
        testHref={`${base}?edit=${opened.id}&view=test`}
        channels={
          <GuidChannels
            key="channels"
            workspaceSlug={workspaceSlug}
            agentId={opened.id}
            channels={view.channels}
            ready={opened.status === "active" && opened.testedCurrent}
            settingsHref={`/app/${workspaceSlug}/settings/channels`}
          />
        }
        notices={
          view.notices ? (
            <GuidNotices key="notices" notices={view.notices} />
          ) : null
        }
        policy={view.policy}
        credentials={view.credentials.map((key) => ({
          id: key.id,
          provider: key.provider,
          purpose: key.purpose,
          label: `${key.label} · ${tConsole(`providers.${key.provider}`)} · ${key.maskedValue}`,
        }))}
        summary={
          <div key="summary" className="space-y-1">
            <p className="text-12 text-text-secondary" data-testid="guid-state">
              {[
                statusLabel(opened.status),
                opened.config.model.model_name
                  ? t("guids.model", { model: opened.config.model.model_name })
                  : t("guids.noModel"),
                details(opened),
                opened.lastTestedAt
                  ? t("guids.lastTested", { date: date(opened.lastTestedAt) })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p
              className="text-12 text-text-secondary"
              data-testid="guid-tested"
            >
              {opened.testedCurrent && opened.testedAt
                ? t("guids.tested", { date: date(opened.testedAt) })
                : opened.status === "active"
                  ? t("guids.untestedActive")
                  : t("guids.untested")}
            </p>
            {opened.missing.length > 0 ? (
              <p
                className="text-12 text-text-secondary"
                data-testid="guid-missing"
              >
                {t("guids.missing", {
                  fields: opened.missing
                    .map((path) =>
                      tConsole(`editor.fields.${path.split(".")[1]}`),
                    )
                    .join(", "),
                })}
              </p>
            ) : null}
          </div>
        }
      />
    );
  }

  const main = (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="workspace-guids">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<Bot className="h-5 w-5" />}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href={`${base}?edit=new`} scroll={false}>
                <Plus />
                {t("guids.new")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <p className="text-12 text-text-secondary" data-testid="guid-quota">
        {view.limit === null
          ? t("guids.quotaUnlimited", { count: view.guids.length })
          : t("guids.quota", { count: view.guids.length, limit: view.limit })}
      </p>
      <ul className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
        {view.guids.map((guid) => (
          <li
            key={guid.id}
            className="flex flex-wrap items-center justify-between gap-2 p-4"
            data-testid="workspace-guid"
          >
            <div className="min-w-0 space-y-1">
              <Link
                href={`${base}?edit=${guid.id}`}
                scroll={false}
                aria-current={guid.id === editKey ? "true" : undefined}
                className="text-14 text-text font-medium hover:underline"
              >
                {guid.name ?? t("guids.unnamed")}
              </Link>
              <p className="text-12 text-text-secondary">{details(guid)}</p>
            </div>
            <Badge
              variant={
                STATUS_BADGE[guid.status as keyof typeof STATUS_BADGE] ??
                "secondary"
              }
            >
              {statusLabel(guid.status)}
            </Badge>
          </li>
        ))}
        {view.guids.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            {view.canManage ? t("guids.emptyManage") : t("guids.empty")}
          </li>
        ) : null}
      </ul>
    </div>
  );

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("guids.panelLabel")}
      closeHref={base}
      editKey={editKey}
      defaultPanelSize="wide"
    />
  );
}
