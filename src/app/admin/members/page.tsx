import type { Metadata } from "next";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { partnerRoleKey } from "@/components/partners/role-label";
import { RoleSelect } from "@/components/partners/role-select";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { PARTNER_ROLES, type PartnerRoleKey } from "@/core/permissions/matrix";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("members.metaTitle") };
}

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

  const t = await getTranslations("partnerConsole");
  const tAll = await getTranslations();
  const roleLabel = (role: string) => {
    const key = partnerRoleKey(role);
    return key ? tAll(key) : role;
  };
  const roleLabels = Object.fromEntries(
    PARTNER_ROLES.map((role) => [role, roleLabel(role)]),
  ) as Record<PartnerRoleKey, string>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        title={t("members.title")}
        description={t("members.description")}
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
                  {self ? ` ${t("members.you")}` : ""}
                </div>
                <div className="text-12 text-text-secondary">
                  {roleLabel(member.role)}
                  {member.status === "active"
                    ? ""
                    : ` · ${t("members.inactive")}`}
                </div>
              </div>
              {canManage && !self ? (
                <div className="flex flex-wrap items-end gap-2">
                  <ActionForm
                    action={updatePartnerMemberAction}
                    submitLabel={t("members.changeRole")}
                    tone="neutral"
                  >
                    <input type="hidden" name="userId" value={member.userId} />
                    <RoleSelect
                      defaultValue={member.role}
                      label={t("members.role")}
                      roleLabels={roleLabels}
                    />
                  </ActionForm>
                  <ActionForm
                    action={updatePartnerMemberAction}
                    submitLabel={
                      member.status === "active"
                        ? t("members.deactivate")
                        : t("members.reactivate")
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
          <h2 className="text-14 text-text font-semibold">
            {t("members.inviteTitle")}
          </h2>
          {invitations.length > 0 ? (
            <ul className="divide-border divide-y">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <div className="text-12 text-text-secondary">
                    {t("members.pendingInvitation", {
                      email: invitation.email,
                      role: roleLabel(invitation.role),
                    })}
                  </div>
                  <ActionForm
                    action={revokePartnerInvitationAction}
                    submitLabel={t("members.revoke")}
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
            submitLabel={t("members.generateInvite")}
            testId="invite-member"
          >
            <Label className="flex-col items-start">
              {t("members.email")}
              <Input name="email" type="email" required />
            </Label>
            <RoleSelect label={t("members.role")} roleLabels={roleLabels} />
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
