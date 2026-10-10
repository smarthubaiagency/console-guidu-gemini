import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listOrganizationMembers } from "@/core/organizations/members";
import { listInvitations } from "@/core/organizations/invitations";
import { Permissions } from "@/core/permissions/catalog";
import { hasOrganizationRolePermission } from "@/core/permissions/matrix";
import type { OrganizationRole } from "@/core/permissions/roles";
import {
  TeamClient,
  type MemberDisplay,
  type InvitationDisplay,
  type TeamCapabilities,
} from "./team-client";

export const metadata: Metadata = {
  title: "Gestão de Equipe e Membros",
};

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

  const { organization, members, invitations, profiles, capabilities } =
    await withContext(prisma, context, async (tx) => {
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

      const [org, orgMembers, orgInvites] = await Promise.all([
        tx.organization.findUnique({
          where: { id: context.organizationId },
        }),
        listOrganizationMembers(tx, context.organizationId),
        canInvite ? listInvitations(tx, context) : [],
      ]);

      const userIds = orgMembers.map((m) => m.userId);
      const userProfiles = await tx.profile.findMany({
        where: { id: { in: userIds } },
      });

      return {
        organization: org,
        members: orgMembers,
        invitations: orgInvites,
        profiles: userProfiles,
        capabilities: {
          canManage: canManageMembers,
          canInvite,
          canManageMembers,
        } satisfies TeamCapabilities,
      };
    });

  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const currentUserMember = members.find((m) => m.userId === identity.userId);
  const currentUserRole = currentUserMember?.role ?? "member";

  const memberDisplays: MemberDisplay[] = members.map((m) => {
    const prof = profileMap.get(m.userId);
    return {
      userId: m.userId,
      name:
        prof?.fullName ??
        (m.userId === identity.userId ? (identity.email ?? "Você") : "Membro"),
      role: m.role,
      status: m.status,
      joinedAt: new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
        new Date(m.createdAt),
      ),
      isCurrentUser: m.userId === identity.userId,
    };
  });

  const invitationDisplays: InvitationDisplay[] = invitations.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    status: i.status,
    expiresAt: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(i.expiresAt)),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>Equipe & Membros</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Equipe e Permissões de Acesso
            </h1>
            <p className="text-12 text-text-secondary">
              Gerencie colaboradores, atribua papéis administrativos e emita
              convites seguros.
            </p>
          </div>
        </div>
      </div>

      <TeamClient
        workspaceSlug={workspaceSlug}
        currentUserId={identity.userId}
        currentUserRole={currentUserRole}
        organizationName={organization?.name ?? "Organização"}
        maxSeats={organization?.maxSeats ?? 5}
        members={memberDisplays}
        invitations={invitationDisplays}
        capabilities={capabilities}
      />
    </div>
  );
}
