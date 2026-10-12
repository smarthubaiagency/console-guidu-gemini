import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Handshake } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { inputClass, labelClass } from "@/components/partners/form-classes";
import { RoleSelect } from "@/components/partners/role-select";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { partnerSubdomainBase } from "@/core/partners/hosts";
import { platformGrants } from "@/core/module-runtime/loaders";
import { PARTNER_ROLES, type PartnerRoleKey } from "@/core/permissions/matrix";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partners.detail");
  return { title: t("metaTitle") };
}

const DOMAIN_STATUSES = new Set(["pending", "active", "disabled"]);
const ROLES = new Set<string>(PARTNER_ROLES);

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
  const t = await getTranslations("partners");
  const roleLabel = (role: string) =>
    ROLES.has(role) ? t(`roles.${role}`) : role;
  const roleLabels = Object.fromEntries(
    PARTNER_ROLES.map((role) => [role, t(`roles.${role}`)]),
  ) as Record<PartnerRoleKey, string>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        title={partner.name}
        description={
          partner.isHouse
            ? t("detail.houseDescription")
            : t(
                partner.status === "active"
                  ? "detail.descriptionActive"
                  : "detail.descriptionSuspended",
                { slug: partner.slug },
              )
        }
        icon={<Handshake className="h-5 w-5" />}
      />

      {editable ? (
        <section className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text mb-2 font-semibold">
            {t("detail.statusTitle")}
          </h2>
          <ActionForm
            action={setPartnerStatusAction}
            submitLabel={
              partner.status === "active"
                ? t("detail.suspend")
                : t("detail.reactivate")
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
            {t("detail.statusHint")}
          </p>
        </section>
      ) : null}

      {!partner.isHouse ? (
        <section className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
          <h2 className="text-14 text-text mb-3 font-semibold">
            {t("detail.domainsTitle")}
          </h2>
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
                      ? t("detail.customDomain")
                      : t("detail.subdomain")}{" "}
                    ·{" "}
                    {DOMAIN_STATUSES.has(domain.status)
                      ? t(`detail.domainStatus.${domain.status}`)
                      : domain.status}
                  </div>
                </div>
                {editable ? (
                  <ActionForm
                    action={setPartnerDomainStatusAction}
                    submitLabel={
                      domain.status === "active"
                        ? t("detail.deactivate")
                        : t("detail.activate")
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
                {t("detail.noDomains")}
              </li>
            ) : null}
          </ul>
          {editable ? (
            <ActionForm
              action={addPartnerDomainAction}
              submitLabel={t("detail.addDomain")}
              testId="add-domain"
            >
              <input type="hidden" name="partnerId" value={partner.id} />
              <label className={labelClass}>
                {t("detail.hostLabel")}
                <input
                  name="host"
                  required
                  placeholder={t("detail.hostPlaceholder")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("detail.kindLabel")}
                <select
                  name="kind"
                  defaultValue="custom"
                  className={inputClass}
                >
                  <option value="custom">{t("detail.customDomain")}</option>
                  <option value="subdomain">{t("detail.kindSubdomain")}</option>
                </select>
              </label>
            </ActionForm>
          ) : null}
          <p className="text-11 text-text-tertiary mt-2">
            {t.rich("detail.domainHint", {
              base: subdomainBase ?? t("detail.baseMissing"),
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        </section>
      ) : null}

      <section className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text mb-3 font-semibold">
          {t("detail.membersTitle")}
        </h2>
        <ul
          className="divide-border mb-4 divide-y"
          data-testid="partner-members"
        >
          {members.map((member) => (
            <li key={member.userId} className="py-2">
              <div className="text-14 text-text">{member.email}</div>
              <div className="text-12 text-text-secondary">
                {roleLabel(member.role)}
                {member.status === "active" ? "" : t("detail.memberInactive")}
              </div>
            </li>
          ))}
          {members.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              {t("detail.noMembers")}
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
                  {t("detail.pendingInvitation", {
                    email: invitation.email,
                    role: roleLabel(invitation.role),
                  })}
                </div>
                {canManage ? (
                  <ActionForm
                    action={revokePartnerInvitationFromPlatformAction}
                    submitLabel={t("detail.revoke")}
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
            submitLabel={t("detail.invite")}
            testId="invite-partner-member"
          >
            <input type="hidden" name="partnerId" value={partner.id} />
            <label className={labelClass}>
              {t("detail.email")}
              <input
                name="email"
                type="email"
                required
                className={inputClass}
              />
            </label>
            <RoleSelect
              defaultValue="partner_owner"
              label={t("detail.role")}
              roleLabels={roleLabels}
            />
          </ActionForm>
        ) : null}
      </section>
    </div>
  );
}
