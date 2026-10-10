import type { Metadata } from "next";
import Link from "next/link";
import { Handshake } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { createPartnerAction } from "@/core/partners/actions";
import { listPartners } from "@/core/partners/management";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Parceiros (Admin)" };

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
  inactive: "Inativo",
};

/** Partners of the platform (ADR 0012, P4a). */
export default async function PlatformPartnersPage() {
  const identity = await requirePlatformAdminPage("/platform/partners");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  const grants = platformGrants(role);
  if (!grants("platform.partners.read")) {
    return <ModuleNotice variant="denied" />;
  }

  const partners = await withIdentityContext(prisma, identity.userId, (tx) =>
    listPartners(tx, { userId: identity.userId, role }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Administração", "Parceiros"]}
        title="Parceiros"
        description="Agências que revendem a plataforma com a própria marca. O parceiro da casa atende os clientes diretos."
        icon={<Handshake className="h-5 w-5" />}
      />

      {grants("platform.partners.manage") ? (
        <section className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text mb-3 font-semibold">
            Novo parceiro
          </h2>
          <ActionForm
            action={createPartnerAction}
            submitLabel="Criar parceiro"
            testId="create-partner"
          >
            <label className={labelClass}>
              Nome
              <input
                name="name"
                required
                maxLength={120}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Identificador
              <input
                name="slug"
                required
                maxLength={48}
                pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
                placeholder="agencia-exemplo"
                className={inputClass}
              />
            </label>
          </ActionForm>
        </section>
      ) : null}

      <ul className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
        {partners.map((partner) => (
          <li
            key={partner.id}
            className="flex items-center justify-between gap-4 p-4"
          >
            <div>
              <Link
                href={`/platform/partners/${partner.id}`}
                className="text-14 text-text font-semibold hover:underline"
              >
                {partner.name}
              </Link>
              <div className="text-12 text-text-secondary">
                {partner.isHouse ? "Parceiro da casa · " : ""}
                {STATUS_LABELS[partner.status] ?? partner.status} ·{" "}
                {partner.activeMembers} membro(s)
              </div>
              <div className="text-11 text-text-tertiary font-mono">
                {partner.slug}
                {partner.domains.length > 0
                  ? ` · ${partner.domains.map((d) => d.host).join(", ")}`
                  : ""}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
