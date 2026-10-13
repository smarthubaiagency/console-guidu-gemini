/**
 * Page of the AI agents module. The prototype left in A2a (D-AG-11); the
 * screens of the GUIDS arrive in A4. Until then the page says the module is
 * unavailable (flag off) or under construction (flag on); with the flag on
 * it lists the workspace's GUIDS with the partner's last change, "Alterado
 * por <parceiro> em <data>" (A3c, especificação §6).
 */

import { Bot, Clock } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { Permissions } from "@/core/permissions/catalog";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listGuids } from "@/modules/ai-agents/server/services/agents";

const STATUSES = new Set(["draft", "active", "paused"]);

export async function generateMetadata() {
  const t = await getTranslations("aiAgents");
  return { title: t("metaTitle") };
}

interface AiAgentsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function AiAgentsPage({ params }: AiAgentsPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/ai-agents`;
  const t = await getTranslations("aiAgents");
  const identity = await requireUserPage(currentPath);

  // Membership is checked even with nothing to show.
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const available = isModuleTechnicallyAvailable("ai-agents");
  const notice = available ? "building" : "unavailable";
  const guids = available
    ? await withContext(prisma, context, async (tx) => {
        const access = await resolveModulePageAccess(
          tx,
          context,
          "ai-agents",
          Permissions.AI_AGENTS_USE,
        );
        return access.kind === "ok" ? listGuids(tx, context) : [];
      })
    : [];
  const format = await getFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short" });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="bg-info-bg text-info-text border-info-border rounded-lg border p-2">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-12 text-text-secondary">{t("description")}</p>
          </div>
        </div>
      </div>

      <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
        <div className="bg-info-bg text-info-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="text-14 text-text mt-4 font-semibold">
          {t(`${notice}.title`)}
        </h2>
        <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
          {t(`${notice}.body`)}
        </p>
      </div>

      {guids.length > 0 ? (
        <ul
          className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
          data-testid="workspace-guids"
        >
          {guids.map((guid) => (
            <li
              key={guid.id}
              className="flex flex-wrap items-center justify-between gap-2 p-4"
              data-testid="workspace-guid"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-14 text-text font-medium">
                  {guid.name ?? t("guids.unnamed")}
                </p>
                <p className="text-12 text-text-secondary">
                  {guid.updatedByPartnerName
                    ? t("guids.changedByPartner", {
                        partner: guid.updatedByPartnerName,
                        date: date(guid.updatedAt),
                      })
                    : t("guids.updated", { date: date(guid.updatedAt) })}
                </p>
              </div>
              <Badge variant="secondary">
                {STATUSES.has(guid.status)
                  ? t(`guids.status.${guid.status}`)
                  : guid.status}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
