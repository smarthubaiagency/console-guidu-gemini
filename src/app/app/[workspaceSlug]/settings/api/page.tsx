import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Code2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { API_ROUTES, type ApiRoute } from "@/core/api/contracts";
import { configuredRateLimits } from "@/core/api/rate-limit";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("api");
  return { title: t("metaTitle") };
}

interface ApiSettingsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * Developer page of the workspace (F4a): base URL, authentication, the
 * read routes of the API v1 with the scope each one needs, the limits and
 * the OpenAPI contract. Keys are created in Configurações › MCP; webhooks
 * come later (plano F4, decisão 4).
 */
export default async function ApiSettingsPage({
  params,
}: ApiSettingsPageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/settings/api`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const origin = (await getRequestOrigin()) ?? "";
  const base = `${origin}/api/v1`;
  const limits = configuredRateLimits();
  const routes = Object.values(API_ROUTES) as ApiRoute[];
  const t = await getTranslations("api");
  const code = (chunks: React.ReactNode) => <code>{chunks}</code>;
  const codeText = (chunks: React.ReactNode) => (
    <code className="text-text">{chunks}</code>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="api-settings">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<Code2 className="h-5 w-5" />}
      />

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("howToConnect")}</h2>
        <ul className="text-12 text-text-secondary space-y-1">
          <li>{t.rich("baseUrl", { base, code: codeText })}</li>
          <li>
            {t("workspaceId")}{" "}
            <code className="text-text" data-testid="api-workspace-id">
              {context.workspaceId}
            </code>
          </li>
          <li>
            {t.rich("auth", {
              code: codeText,
              link: (chunks) => (
                <Link
                  href={`/app/${workspaceSlug}/settings/mcp`}
                  className="text-primary inline-flex items-center gap-1 font-semibold"
                >
                  {chunks} <ArrowRight className="h-3 w-3" />
                </Link>
              ),
            })}
          </li>
          <li>
            {t.rich("limits", {
              key: limits.key,
              user: limits.user,
              workspace: limits.workspace,
              code,
            })}
          </li>
          <li>{t.rich("errors", { code })}</li>
          <li>
            {t("contract")}{" "}
            <a
              href={`${base}/openapi.json`}
              className="text-primary font-semibold"
            >
              openapi.json
            </a>
          </li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("routesTitle")}</h2>
        <ul className="divide-border divide-y" data-testid="api-routes">
          {routes.map((route) => (
            <li
              key={route.operationId}
              className="text-12 text-text-secondary py-2"
            >
              <code className="text-text font-semibold">
                {route.method} {route.path}
              </code>{" "}
              · {t("scope")} <code>{route.scope}</code> ·{" "}
              {t.has(`routes.${route.operationId}`)
                ? t(`routes.${route.operationId}`)
                : route.summary}
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          {t("webhooksTitle")}
        </h2>
        <p className="text-12 text-text-secondary">{t("webhooksSoon")}</p>
      </section>
    </div>
  );
}
