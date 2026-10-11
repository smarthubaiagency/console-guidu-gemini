import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { formatDate, sectionClass } from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { withPlatformContext } from "@/core/platform-api/context";
import { listPlatformApiKeys } from "@/core/platform-api/keys";
import {
  PLATFORM_SCOPE_DEFINITIONS,
  roleAllowsScope,
} from "@/core/platform-api/scopes";
import { prisma } from "@/lib/prisma/client";

import {
  CreatePlatformKeyForm,
  RevokePlatformKeyButton,
} from "./platform-key-forms";

export const metadata: Metadata = { title: "Chaves de API (Admin)" };

const STATUS_LABELS = {
  active: "Ativa",
  revoked: "Revogada",
  expired: "Vencida",
} as const;

/**
 * Administrative keys of the platform API and MCP (F4e): each internal role
 * member creates their own, with the scopes their role allows; the platform
 * owner sees and revokes every key.
 */
export default async function PlatformApiKeysPage() {
  const identity = await requirePlatformAdminPage("/platform/api-keys");
  const member = await getPlatformAdminMember(prisma, identity.userId);
  const role = (member?.role ?? null) as PlatformAdminRoleKey | null;
  const keys = await withPlatformContext(
    prisma,
    { userId: identity.userId, keyId: null },
    (tx) => listPlatformApiKeys(tx, { userId: identity.userId, role }),
  );
  const scopes = PLATFORM_SCOPE_DEFINITIONS.filter((s) =>
    roleAllowsScope(role, s.id),
  );

  return (
    <div
      className="mx-auto max-w-4xl space-y-6"
      data-testid="platform-api-keys"
    >
      <ModulePageHeader
        trail={["Administração", "Chaves de API"]}
        title="Chaves de API da plataforma"
        description="Chaves administrativas para a API /api/v1/platform e o MCP /mcp/platform. Só leitura, só nos hosts da plataforma; nunca valem nas rotas de workspace."
        icon={<KeyRound className="h-5 w-5" />}
      />

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">Nova chave</h2>
        <p className="text-12 text-text-secondary">
          A chave aparece uma vez só. Ela vale enquanto você tiver um papel
          interno que permita os escopos escolhidos.
        </p>
        <CreatePlatformKeyForm scopes={scopes} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          Chaves ({keys.length})
        </h2>
        <ul className="divide-border divide-y" data-testid="platform-key-list">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              data-testid="platform-key"
            >
              <span className="text-12 text-text-secondary">
                <span className="text-text font-semibold">{key.name}</span> ·{" "}
                <code>{key.prefix}</code> · {key.scopes.join(", ")} ·{" "}
                <span data-testid="platform-key-status">
                  {STATUS_LABELS[key.status]}
                </span>{" "}
                · vence em {formatDate(key.expiresAt)}
                {key.lastUsedAt
                  ? ` · último uso ${formatDate(key.lastUsedAt)}`
                  : ""}
                {key.mine ? "" : " · de outra pessoa"}
              </span>
              {key.status === "active" ? (
                <RevokePlatformKeyButton keyId={key.id} />
              ) : null}
            </li>
          ))}
          {keys.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Nenhuma chave ainda.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
