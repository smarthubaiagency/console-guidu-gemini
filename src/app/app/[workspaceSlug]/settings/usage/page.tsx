import type { Metadata } from "next";
import { Gauge } from "lucide-react";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { statusLabel } from "@/core/billing/subscriptions";
import { loadUsage, type UsageRow } from "@/core/entitlements/usage";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Consumo & Limites" };

interface UsagePageProps {
  params: Promise<{ workspaceSlug: string }>;
}

const SOURCE_LABELS: Record<UsageRow["source"], string> = {
  plan: "limite do plano",
  default: "limite padrão",
  none: "sem limite",
};

function UsageMeter({ row }: { row: UsageRow }) {
  const percent =
    row.used !== null && row.limit
      ? Math.min(100, Math.round((row.used / row.limit) * 100))
      : null;
  const over = row.used !== null && row.limit !== null && row.used > row.limit;
  return (
    <li className="space-y-2 py-3" data-testid={`usage-${row.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-14 text-text font-semibold">{row.label}</span>
        <span className="text-14 text-text font-bold" data-testid="usage-value">
          {row.used === null
            ? "Sem dados"
            : row.limit === null
              ? `${row.used}`
              : `${row.used} / ${row.limit}`}
        </span>
      </div>
      {percent !== null ? (
        <progress
          className={`progress-bar ${over ? "text-danger-solid" : "text-primary"}`}
          value={percent}
          max={100}
          aria-label={row.label}
        />
      ) : null}
      <div className="text-12 text-text-secondary">
        {row.scope === "organization" ? "Empresa" : "Este workspace"} ·{" "}
        {SOURCE_LABELS[row.source]}
        {over
          ? " · acima do limite: nada foi apagado, mas novos itens ficam bloqueados"
          : ""}
      </div>
    </li>
  );
}

/**
 * Real usage against the company's plan (F3b, Especificação §18 e §22).
 * Every number is measured on the server; nothing is simulated.
 */
export default async function UsagePage({ params }: UsagePageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/usage`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const usage = await withContext(prisma, context, (tx) =>
    loadUsage(tx, context),
  );
  const contract = usage.contract;

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="usage-page">
      <ModulePageHeader
        trail={["Configurações", "Consumo & Limites"]}
        title="Consumo, cotas e capacidade"
        description="Uso medido da empresa e deste workspace frente aos limites do plano."
        icon={<Gauge className="h-5 w-5" />}
      />

      <section className={sectionClass} data-testid="usage-plan">
        <h2 className="text-14 text-text font-semibold">Plano</h2>
        <p className="text-12 text-text-secondary">
          {contract.kind === "legacy"
            ? "Sem assinatura: módulos e limites seguem como antes (legado)."
            : `${contract.planName} (versão ${contract.planVersion}) · ${statusLabel(contract.status)}${
                contract.provisional ? " · valores provisórios" : ""
              }`}
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Limites</h2>
        <ul className="divide-border divide-y">
          {usage.rows.map((row) => (
            <UsageMeter key={row.key} row={row} />
          ))}
        </ul>
      </section>
    </div>
  );
}
