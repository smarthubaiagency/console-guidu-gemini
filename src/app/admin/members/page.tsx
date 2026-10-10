import type { Metadata } from "next";
import { Users } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { partnerRoleLabel } from "@/components/partners/role-label";
import { RoleSelect } from "@/components/partners/role-select";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import {
  invitePartnerMemberAction,
  revokePartnerInvitationAction,
  updatePartnerMemberAction,
} from "@/core/partners/actions";
import {
  listPartnerMembers,
  listPendingPartnerInvitations,
} from "@/core/partners/members";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Membros (Parceiro)" };

/** Members of the partner; only the partner_owner manages them (P4a). */
export default async function PartnerMembersPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/members");
  const grants = partnerGrants(membership.role);
  if (!grants("partner.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("partner.members.manage");

  const { members, invitations } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      members: await listPartnerMembers(tx, partner.partnerId),
      invitations: canManage
        ? await listPendingPartnerInvitations(tx, partner.partnerId)
        : [],
    }),
    { partnerId: partner.partnerId },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Parceiro", "Membros"]}
        title="Membros"
        description="Pessoas da equipe do parceiro e seus papéis."
        icon={<Users className="h-5 w-5" />}
      />

      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="partner-member-list"
      >
        {members.map((member) => {
          const self = member.userId === identity.userId;
          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-4 p-4"
            >
              <div>
                <div className="text-14 text-text font-semibold">
                  {member.email}
                  {self ? " (você)" : ""}
                </div>
                <div className="text-12 text-text-secondary">
                  {partnerRoleLabel(member.role)}
                  {member.status === "active" ? "" : " · inativo"}
                </div>
              </div>
              {canManage && !self ? (
                <div className="flex flex-wrap items-end gap-2">
                  <ActionForm
                    action={updatePartnerMemberAction}
                    submitLabel="Alterar papel"
                    tone="neutral"
                  >
                    <input type="hidden" name="userId" value={member.userId} />
                    <RoleSelect defaultValue={member.role} />
                  </ActionForm>
                  <ActionForm
                    action={updatePartnerMemberAction}
                    submitLabel={
                      member.status === "active" ? "Desativar" : "Reativar"
                    }
                    tone="neutral"
                  >
                    <input type="hidden" name="userId" value={member.userId} />
                    <input
                      type="hidden"
                      name="status"
                      value={member.status === "active" ? "inactive" : "active"}
                    />
                  </ActionForm>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canManage ? (
        <section className="border-card-border bg-surface-card space-y-4 rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text font-semibold">Convidar membro</h2>
          {invitations.length > 0 ? (
            <ul className="divide-border divide-y">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <div className="text-12 text-text-secondary">
                    Convite pendente: {invitation.email} ·{" "}
                    {partnerRoleLabel(invitation.role)}
                  </div>
                  <ActionForm
                    action={revokePartnerInvitationAction}
                    submitLabel="Revogar"
                    tone="neutral"
                  >
                    <input
                      type="hidden"
                      name="invitationId"
                      value={invitation.id}
                    />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm
            action={invitePartnerMemberAction}
            submitLabel="Gerar convite"
            testId="invite-member"
          >
            <label className={labelClass}>
              E-mail
              <input
                name="email"
                type="email"
                required
                className={inputClass}
              />
            </label>
            <RoleSelect />
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
