import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Code2 } from "lucide-react";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { API_ROUTES, type ApiRoute } from "@/core/api/contracts";
import { configuredRateLimits } from "@/core/api/rate-limit";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";

export const metadata: Metadata = {
  title: "API e Webhooks — Configurações",
};

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

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="api-settings">
      <ModulePageHeader
        trail={["Configurações", "API e Webhooks"]}
        title="API e Webhooks"
        description="API REST v1 para integrar este workspace a outros sistemas."
        icon={<Code2 className="h-5 w-5" />}
      />

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Como conectar</h2>
        <ul className="text-12 text-text-secondary space-y-1">
          <li>
            Endereço base: <code className="text-text">{base}</code>
          </li>
          <li>
            Id deste workspace:{" "}
            <code className="text-text" data-testid="api-workspace-id">
              {context.workspaceId}
            </code>
          </li>
          <li>
            Autenticação: cabeçalho{" "}
            <code className="text-text">Authorization: Bearer gdu_live_…</code>{" "}
            com uma chave criada em{" "}
            <Link
              href={`/app/${workspaceSlug}/settings/mcp`}
              className="text-primary inline-flex items-center gap-1 font-semibold"
            >
              Configurações › MCP <ArrowRight className="h-3 w-3" />
            </Link>
            . A chave vale só para este workspace e para os escopos marcados
            nela, e só neste endereço.
          </li>
          <li>
            Limites provisórios por minuto: {limits.key} por chave,{" "}
            {limits.user} por pessoa e {limits.workspace} por workspace. Acima
            disso a resposta é 429 com <code>Retry-After</code>.
          </li>
          <li>
            Erros trazem <code>code</code>, <code>message</code> e{" "}
            <code>requestId</code>; informe o requestId ao suporte.
          </li>
          <li>
            Contrato completo:{" "}
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
        <h2 className="text-14 text-text font-semibold">Rotas disponíveis</h2>
        <ul className="divide-border divide-y" data-testid="api-routes">
          {routes.map((route) => (
            <li
              key={route.operationId}
              className="text-12 text-text-secondary py-2"
            >
              <code className="text-text font-semibold">
                {route.method} {route.path}
              </code>{" "}
              · escopo <code>{route.scope}</code> · {route.summary}
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Webhooks</h2>
        <p className="text-12 text-text-secondary">
          Em breve: avisos da plataforma para um endereço seu quando algo
          acontecer neste workspace.
        </p>
      </section>
    </div>
  );
}
