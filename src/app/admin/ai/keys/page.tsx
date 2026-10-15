import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { calendarDateFormatter } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { aiPolicy } from "@/core/ai/catalog";
import { listPartnerCredentials } from "@/core/ai/keys";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { RegisterKeyForm, RevokeKeyButton } from "./key-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aiConsole");
  return { title: t("keys.metaTitle") };
}

/**
 * The partner's admin keys (A3b, especificação §9.1): used by its GUIDU
 * Assistant, in `/admin` and for its customers' questions in `/app`. The
 * secret is encrypted and appears masked only.
 */
export default async function PartnerAiKeysPage() {
  if (!isModuleTechnicallyAvailable("ai-agents")) notFound();
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/ai/keys");
  if (!partnerGrants(membership.role)("partner.ai_agents.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const { keys, providers } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      keys: await listPartnerCredentials(
        tx,
        { userId: identity.userId, partnerRole: membership.role },
        partner.partnerId,
      ),
      // CF6a: only the providers the platform and the partner offer.
      providers: (await aiPolicy(tx)).providers,
    }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("aiConsole");
  const formatDate = await calendarDateFormatter();

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="partner-ai-keys">
      <ModulePageHeader
        title={t("keys.title")}
        description={t("keys.description")}
        icon={<KeyRound className="h-5 w-5" />}
      />
      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-6 shadow-xs">
        <h2 className="text-14 text-text font-semibold">{t("keys.new")}</h2>
        <RegisterKeyForm providers={providers} />
      </section>
      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-6 shadow-xs">
        <h2 className="text-14 text-text font-semibold">
          {t("keys.list", { count: keys.length })}
        </h2>
        <ul className="divide-border divide-y" data-testid="partner-key-list">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              data-testid="partner-key"
            >
              <span className="text-12 text-text-secondary">
                <span className="text-text font-semibold">{key.label}</span>
                {" · "}
                {t(`providers.${key.provider}`)} ·{" "}
                <code>{key.maskedValue}</code>
                {" · "}
                {t(`keys.purpose.${key.purpose}`)}
                {" · "}
                <span data-testid="partner-key-status">
                  {t(`keys.status.${key.status}`)}
                </span>
                {" · "}
                {t("keys.created_at", {
                  date: formatDate(new Date(key.createdAt)),
                })}
              </span>
              {key.status === "active" ? (
                <RevokeKeyButton credentialId={key.id} label={key.label} />
              ) : null}
            </li>
          ))}
          {keys.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              {t("keys.empty")}
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
