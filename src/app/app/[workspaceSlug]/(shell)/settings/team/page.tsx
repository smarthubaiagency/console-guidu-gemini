import { Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { resolveSeatLimit } from "@/core/entitlements/quotas";
import { listOrganizationMembers } from "@/core/organizations/members";
import { listInvitations } from "@/core/organizations/invitations";
import { Permissions } from "@/core/permissions/catalog";
import { hasOrganizationRolePermission } from "@/core/permissions/matrix";
import {
  WorkspaceRoles,
  type OrganizationRole,
} from "@/core/permissions/roles";
import {
  TeamClient,
  type MemberDisplay,
  type InvitationDisplay,
  type TeamCapabilities,
} from "./team-client";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

export async function generateMetadata() {
  const t = await getTranslations("team");
  return { title: t("metaTitle") };
}

interface TeamPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function TeamSettingsPage({ params }: TeamPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/settings/team`;
  const identity = await requireUserPage(currentPath);

  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(context);

  const {
    organization,
    seatLimit,
    members,
    attendantIds,
    invitations,
    profiles,
    capabilities,
  } = await withContext(prisma, context, async (tx) => {
    const orgMember = await tx.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
    });

    const orgRole =
      orgMember?.status === "active"
        ? (orgMember.role as OrganizationRole)
        : null;

    const canInvite = orgRole
      ? hasOrganizationRolePermission(
          orgRole,
          Permissions.ORGANIZATION_MEMBERS_INVITE,
        )
      : false;

    const canManageMembers = orgRole
      ? hasOrganizationRolePermission(
          orgRole,
          Permissions.ORGANIZATION_MEMBERS_MANAGE,
        )
      : false;

    const [org, orgMembers, orgInvites, attendants] = await Promise.all([
      tx.organization.findUnique({
        where: { id: context.organizationId },
      }),
      listOrganizationMembers(tx, context.organizationId),
      canInvite ? listInvitations(tx, context) : [],
      // Attendants of this workspace (AT1) show as such in the company list.
      tx.workspaceMember.findMany({
        where: {
          workspaceId: context.workspaceId,
          role: WorkspaceRoles.ATTENDANT,
        },
        select: { userId: true },
      }),
    ]);

    const userIds = orgMembers.map((m) => m.userId);
    const userProfiles = await tx.profile.findMany({
      where: { id: { in: userIds } },
    });

    return {
      organization: org,
      // Plan limit (F3b) when the company has one, else max_seats.
      seatLimit: await resolveSeatLimit(
        tx,
        context.organizationId,
        org?.maxSeats ?? 5,
      ),
      members: orgMembers,
      attendantIds: new Set(attendants.map((a) => a.userId)),
      invitations: orgInvites,
      profiles: userProfiles,
      capabilities: {
        canManage: canManageMembers,
        canInvite,
        canManageMembers,
      } satisfies TeamCapabilities,
    };
  });

  const t = await getTranslations("team");
  const format = await getFormatter();
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const currentUserMember = members.find((m) => m.userId === identity.userId);
  const currentUserRole = currentUserMember?.role ?? "member";

  const memberDisplays: MemberDisplay[] = members.map((m) => {
    const prof = profileMap.get(m.userId);
    return {
      userId: m.userId,
      name:
        prof?.fullName ??
        (m.userId === identity.userId
          ? (identity.email ?? t("you"))
          : t("memberFallback")),
      role: attendantIds.has(m.userId) ? WorkspaceRoles.ATTENDANT : m.role,
      status: m.status,
      joinedAt: format.dateTime(new Date(m.createdAt), { dateStyle: "short" }),
      isCurrentUser: m.userId === identity.userId,
    };
  });

  const invitationDisplays: InvitationDisplay[] = invitations.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    status: i.status,
    expiresAt: format.dateTime(new Date(i.expiresAt), {
      dateStyle: "short",
      timeStyle: "short",
    }),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-12 text-text-secondary">{t("description")}</p>
          </div>
        </div>
      </div>

      <TeamClient
        workspaceSlug={workspaceSlug}
        currentUserId={identity.userId}
        currentUserRole={currentUserRole}
        organizationName={organization?.name ?? t("organizationFallback")}
        maxSeats={seatLimit}
        members={memberDisplays}
        invitations={invitationDisplays}
        capabilities={capabilities}
      />
    </div>
  );
}
