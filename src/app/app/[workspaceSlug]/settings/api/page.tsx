import type { Metadata } from "next";
import Link from "next/link";
import { Code2, ArrowRight, Bot } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";

export const metadata: Metadata = {
  title: "API e Webhooks — Configurações",
};

interface ApiSettingsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ApiSettingsPage({ params }: ApiSettingsPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/settings/api`;
  const identity = await requireUserPage(currentPath);

  // Validate user has access to workspace
  await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>API e Webhooks</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Code2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              API e Webhooks
            </h1>
            <p className="text-12 text-text-secondary">
              Integrações REST e webhooks para desenvolvedores e plataformas externas.
            </p>
          </div>
        </div>
      </div>

      {/* Clean Phase 4 Placeholder Card */}
      <div className="border-card-border bg-surface-card rounded-xl border p-8 shadow-xs">
        <div className="mx-auto max-w-xl text-center space-y-4">
          <div className="bg-surface-raised mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border">
            <Code2 className="text-text-subtle h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <span className="text-11 bg-surface-raised text-text-secondary border-border inline-block rounded-full border px-3 py-1 font-semibold uppercase tracking-wider">
              Fase 4
            </span>
            <h2 className="text-18 text-text font-semibold">
              Em breve — chaves REST e webhooks (Fase 4)
            </h2>
            <p className="text-12 text-text-secondary leading-relaxed">
              A emissão de chaves da plataforma para a API REST (/api/v1) e a configuração de endpoints de webhooks serão disponibilizadas na Fase 4.
            </p>
          </div>

          {/* Informational redirection to /settings/mcp */}
          <div className="border-border bg-surface-sidebar mt-6 rounded-lg border p-4 text-left">
            <div className="flex items-start gap-3">
              <div className="bg-surface-card rounded-md p-1.5 border border-border">
                <Bot className="text-text-secondary h-4 w-4" />
              </div>
              <div className="space-y-1">
                <p className="text-12 text-text font-semibold">
                  Procurando conexões com assistentes de IA (MCP)?
                </p>
                <p className="text-11 text-text-secondary">
                  A gestão de tokens pessoais para conexão com Claude Code, Cursor e Codex está disponível na página de assistentes MCP.
                </p>
                <div className="pt-2">
                  <Link
                    href={`/app/${workspaceSlug}/settings/mcp`}
                    className="text-12 text-primary hover:text-primary-hover inline-flex items-center gap-1 font-semibold transition"
                  >
                    <span>Configurar assistentes MCP</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
