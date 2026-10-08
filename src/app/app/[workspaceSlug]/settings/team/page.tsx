import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listOrganizationMembers } from "@/core/organizations/members";
import { listInvitations } from "@/core/organizations/invitations";
import { TeamClient, type MemberDisplay, type InvitationDisplay } from "./team-client";

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

  const context = await resolveWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { organization, members, invitations, profiles } = await withContext(
    prisma,
    context,
    async (tx) => {
      const [org, orgMembers, orgInvites] = await Promise.all([
        tx.organization.findUnique({
          where: { id: context.organizationId },
        }),
        listOrganizationMembers(tx, context.organizationId),
        listInvitations(tx, context.organizationId),
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
      };
    },
  );

  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const currentUserMember = members.find((m) => m.userId === identity.userId);
  const currentUserRole = currentUserMember?.role ?? "member";

  const memberDisplays: MemberDisplay[] = members.map((m) => {
    const prof = profileMap.get(m.userId);
    return {
      userId: m.userId,
      name: prof?.fullName ?? (m.userId === identity.userId ? identity.email ?? "Você" : "Membro"),
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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>Equipe & Membros</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Equipe e Permissões de Acesso
            </h1>
            <p className="text-xs text-neutral-500">
              Gerencie colaboradores, atribua papéis administrativos e emita convites seguros.
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
      />
    </div>
  );
}
