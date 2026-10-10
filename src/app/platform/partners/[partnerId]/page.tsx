import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Handshake } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { partnerRoleLabel } from "@/components/partners/role-label";
import { RoleSelect } from "@/components/partners/role-select";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { partnerSubdomainBase } from "@/core/partners/hosts";
import { platformGrants } from "@/core/module-runtime/loaders";
import {
  addPartnerDomainAction,
  invitePartnerMemberFromPlatformAction,
  revokePartnerInvitationFromPlatformAction,
  setPartnerDomainStatusAction,
  setPartnerStatusAction,
} from "@/core/partners/actions";
import {
  listPartnerMembers,
  listPendingPartnerInvitations,
} from "@/core/partners/members";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Parceiro (Admin)" };

const DOMAIN_STATUS: Record<string, string> = {
  pending: "Pendente",
  active: "Ativo",
  disabled: "Desativado",
};

/** One partner: status, domains, members and invitations (ADR 0012, P4a). */
export default async function PlatformPartnerPage({
  params,
}: Readonly<{ params: Promise<{ partnerId: string }> }>) {
  const { partnerId } = await params;
  const identity = await requirePlatformAdminPage(
    `/platform/partners/${partnerId}`,
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const grants = platformGrants(admin?.status === "active" ? admin.role : null);
  if (!grants("platform.partners.read")) {
    return <ModuleNotice variant="denied" />;
  }
  if (!/^[0-9a-f-]{36}$/.test(partnerId)) notFound();

  const data = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => {
      const partner = await tx.partner.findUnique({
        where: { id: partnerId },
        include: { domains: { orderBy: { host: "asc" } } },
      });
      if (!partner) return null;
      return {
        partner,
        members: await listPartnerMembers(tx, partnerId),
        invitations: await listPendingPartnerInvitations(tx, partnerId),
      };
    },
  );
  if (!data) notFound();
  const { partner, members, invitations } = data;
  const canManage = grants("platform.partners.manage");
  const subdomainBase = partnerSubdomainBase(process.env);
  const editable = canManage && !partner.isHouse;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Administração", "Parceiros", partner.name]}
        title={partner.name}
        description={
          partner.isHouse
            ? "Parceiro da casa: marca e domínios da plataforma. Membros podem usar o console /admin no domínio da plataforma."
            : `Identificador ${partner.slug} · ${partner.status === "active" ? "ativo" : "suspenso"}`
        }
        icon={<Handshake className="h-5 w-5" />}
      />

      {editable ? (
        <section className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text mb-2 font-semibold">Situação</h2>
          <ActionForm
            action={setPartnerStatusAction}
            submitLabel={
              partner.status === "active"
                ? "Suspender parceiro"
                : "Reativar parceiro"
            }
            tone="neutral"
            testId="partner-status"
          >
            <input type="hidden" name="partnerId" value={partner.id} />
            <input
              type="hidden"
              name="status"
              value={partner.status === "active" ? "suspended" : "active"}
            />
          </ActionForm>
          <p className="text-11 text-text-tertiary mt-2">
            Suspenso, o parceiro perde o console e os domínios dele deixam de
            resolver.
          </p>
        </section>
      ) : null}

      {!partner.isHouse ? (
        <section className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text mb-3 font-semibold">Domínios</h2>
          <ul className="divide-border mb-4 divide-y">
            {partner.domains.map((domain) => (
              <li
                key={domain.host}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div>
                  <div className="text-14 text-text font-mono">
                    {domain.host}
                  </div>
                  <div className="text-12 text-text-secondary">
                    {domain.kind === "custom"
                      ? "Domínio próprio"
                      : "Subdomínio"}{" "}
                    · {DOMAIN_STATUS[domain.status] ?? domain.status}
                  </div>
                </div>
                {editable ? (
                  <ActionForm
                    action={setPartnerDomainStatusAction}
                    submitLabel={
                      domain.status === "active" ? "Desativar" : "Ativar"
                    }
                    tone="neutral"
                  >
                    <input type="hidden" name="partnerId" value={partner.id} />
                    <input type="hidden" name="host" value={domain.host} />
                    <input
                      type="hidden"
                      name="status"
                      value={domain.status === "active" ? "disabled" : "active"}
                    />
                  </ActionForm>
                ) : null}
              </li>
            ))}
            {partner.domains.length === 0 ? (
              <li className="text-12 text-text-secondary py-2">
                Nenhum domínio cadastrado.
              </li>
            ) : null}
          </ul>
          {editable ? (
            <ActionForm
              action={addPartnerDomainAction}
              submitLabel="Cadastrar domínio"
              testId="add-domain"
            >
              <input type="hidden" name="partnerId" value={partner.id} />
              <label className={labelClass}>
                Domínio ou nome do subdomínio
                <input
                  name="host"
                  required
                  placeholder="app.agencia.com.br ou agencia"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Tipo
                <select
                  name="kind"
                  defaultValue="custom"
                  className={inputClass}
                >
                  <option value="custom">Domínio próprio</option>
                  <option value="subdomain">Subdomínio da plataforma</option>
                </select>
              </label>
            </ActionForm>
          ) : null}
          <p className="text-11 text-text-tertiary mt-2">
            Domínio próprio: informe o endereço completo. Subdomínio da
            plataforma: informe só o nome, que vira{" "}
            <code>nome.{subdomainBase ?? "(base não configurada)"}</code>. Até a
            verificação automática de DNS (P7), ativar um domínio é uma decisão
            manual registrada na auditoria.
          </p>
        </section>
      ) : null}

      <section className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text mb-3 font-semibold">Membros</h2>
        <ul
          className="divide-border mb-4 divide-y"
          data-testid="partner-members"
        >
          {members.map((member) => (
            <li key={member.userId} className="py-2">
              <div className="text-14 text-text">{member.email}</div>
              <div className="text-12 text-text-secondary">
                {partnerRoleLabel(member.role)}
                {member.status === "active" ? "" : " · inativo"}
              </div>
            </li>
          ))}
          {members.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Nenhum membro ainda. Convide o proprietário do parceiro.
            </li>
          ) : null}
        </ul>

        {invitations.length > 0 ? (
          <ul className="divide-border mb-4 divide-y">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div className="text-12 text-text-secondary">
                  Convite pendente: {invitation.email} ·{" "}
                  {partnerRoleLabel(invitation.role)}
                </div>
                {canManage ? (
                  <ActionForm
                    action={revokePartnerInvitationFromPlatformAction}
                    submitLabel="Revogar"
                    tone="neutral"
                  >
                    <input type="hidden" name="partnerId" value={partner.id} />
                    <input
                      type="hidden"
                      name="invitationId"
                      value={invitation.id}
                    />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canManage ? (
          <ActionForm
            action={invitePartnerMemberFromPlatformAction}
            submitLabel="Gerar convite"
            testId="invite-partner-member"
          >
            <input type="hidden" name="partnerId" value={partner.id} />
            <label className={labelClass}>
              E-mail
              <input
                name="email"
                type="email"
                required
                className={inputClass}
              />
            </label>
            <RoleSelect defaultValue="partner_owner" />
          </ActionForm>
        ) : null}
      </section>
    </div>
  );
}
