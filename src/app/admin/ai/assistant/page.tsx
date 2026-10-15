import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPartnerAssistant } from "@/core/ai/assistant-config";
import { aiPolicy } from "@/core/ai/catalog";
import { listPartnerCredentials } from "@/core/ai/keys";
import { getNoticeWebhook } from "@/core/ai/notices/webhook";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { AssistantForm } from "./assistant-form";
import { NoticeWebhookForm } from "./notice-webhook-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("assistant.metaTitle") };
}

/**
 * The partner's GUIDU Assistant (A3b, especificação §4): name,
 * instructions and model connection with an admin key, and on or off.
 * Support reads the summary; owner and admin edit.
 */
export default async function PartnerAiAssistantPage() {
  if (!isModuleTechnicallyAvailable("ai-agents")) notFound();
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/ai/assistant",
  );
  const grants = partnerGrants(membership.role);
  if (!grants("partner.ai_agents.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("partner.ai_agents.manage");
  const actor = {
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership.role,
  };
  const { assistant, keys, webhook, policy } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      assistant: await getPartnerAssistant(tx, actor),
      policy: await aiPolicy(tx),
      keys: canManage
        ? await listPartnerCredentials(tx, actor, partner.partnerId)
        : [],
      webhook: canManage
        ? await getNoticeWebhook(tx, actor, partner.partnerId)
        : null,
    }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("aiConsole");
  const credentials = keys
    .filter((key) => key.status === "active" && key.purpose !== "embeddings")
    .map((key) => ({
      id: key.id,
      provider: key.provider,
      label: `${key.label} · ${t(`providers.${key.provider}`)} · ${key.maskedValue}`,
    }));

  return (
    <div
      className="mx-auto max-w-4xl space-y-6"
      data-testid="partner-ai-assistant"
    >
      <ModulePageHeader
        title={t("assistant.title")}
        description={t("assistant.description")}
        icon={<Sparkles className="h-5 w-5" />}
      />
      <section className="border-card-border bg-surface-card space-y-2 rounded-xl border p-6 shadow-xs">
        <p className="text-14 text-text font-semibold">
          {assistant.config.overview.agent_name ?? t("assistant.unnamed")}
        </p>
        <p
          className="text-12 text-text-secondary"
          data-testid="assistant-state"
        >
          {t(`assistant.status.${assistant.status}`)}
          {assistant.config.model.model_name
            ? ` · ${t("assistant.model", { model: assistant.config.model.model_name })}`
            : ` · ${t("assistant.noModel")}`}
        </p>
        {assistant.missing.length > 0 ? (
          <p
            className="text-12 text-text-secondary"
            data-testid="assistant-missing"
          >
            {t("assistant.missing", {
              fields: assistant.missing
                .map((path) => t(`editor.fields.${path.split(".")[1]}`))
                .join(", "),
            })}
          </p>
        ) : null}
        {canManage && credentials.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("assistant.noKeys")}</p>
        ) : null}
      </section>
      {canManage ? (
        <section className="border-card-border bg-surface-card rounded-xl border p-6 shadow-xs">
          <AssistantForm
            assistant={assistant}
            credentials={credentials}
            policy={policy}
          />
        </section>
      ) : null}
      {canManage ? (
        <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-6 shadow-xs">
          <div className="space-y-1">
            <h2 className="text-14 text-text font-semibold">
              {t("noticeWebhook.title")}
            </h2>
            <p className="text-12 text-text-secondary">
              {t("noticeWebhook.description")}
            </p>
          </div>
          <NoticeWebhookForm webhook={webhook} />
        </section>
      ) : (
        <p className="text-12 text-text-secondary">{t("assistant.readOnly")}</p>
      )}
    </div>
  );
}
