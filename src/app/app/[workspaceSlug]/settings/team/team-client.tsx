"use client";

import { useState, useTransition } from "react";
import {
  Users,
  UserPlus,
  Shield,
  Trash2,
  XCircle,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  createInvitationAction,
  revokeInvitationAction,
  updateMemberRoleAction,
  removeMemberAction,
  type ActionState,
} from "@/core/workspaces/team-actions";

export type MemberDisplay = {
  userId: string;
  name: string;
  role: string;
  status: string;
  joinedAt: string;
  isCurrentUser: boolean;
};

export type InvitationDisplay = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
};

export type TeamCapabilities = {
  canManage: boolean;
  canInvite: boolean;
  canManageMembers: boolean;
};

interface TeamClientProps {
  workspaceSlug: string;
  currentUserId: string;
  currentUserRole: string;
  organizationName: string;
  maxSeats: number;
  members: MemberDisplay[];
  invitations: InvitationDisplay[];
  capabilities: TeamCapabilities;
}

export function TeamClient({
  workspaceSlug,
  currentUserId,
  currentUserRole,
  organizationName,
  maxSeats,
  members,
  invitations,
  capabilities,
}: TeamClientProps) {
  const [isPending, startTransition] = useTransition();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  // Invite Form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "owner">(
    "member",
  );

  const isOwner = currentUserRole === "owner";

  const activeMembersCount = members.filter(
    (m) => m.status === "active",
  ).length;
  const pendingInvitesCount = invitations.filter(
    (i) => i.status === "pending",
  ).length;
  const totalOccupiedSeats = activeMembersCount + pendingInvitesCount;
  const isSeatLimitReached = totalOccupiedSeats >= maxSeats;

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 3000);
  };

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("email", inviteEmail);
      formData.append("role", inviteRole);

      const res = await createInvitationAction({}, formData);
      setFeedback(res);
      if (res.success) {
        setInviteEmail("");
        setInviteModalOpen(false);
      }
    });
  };

  const handleRevokeInvite = (invitationId: string) => {
    if (!confirm("Tem certeza que deseja revogar este convite?")) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("invitationId", invitationId);

      const res = await revokeInvitationAction({}, formData);
      setFeedback(res);
    });
  };

  const handleUpdateRole = (
    targetUserId: string,
    newRole: "owner" | "admin" | "member",
  ) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("targetUserId", targetUserId);
      formData.append("newRole", newRole);

      const res = await updateMemberRoleAction({}, formData);
      setFeedback(res);
    });
  };

  const handleRemoveMember = (targetUserId: string, memberName: string) => {
    if (
      !confirm(
        `Remover "${memberName}" da organização? O acesso será revogado imediatamente.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("targetUserId", targetUserId);

      const res = await removeMemberAction({}, formData);
      setFeedback(res);
    });
  };

  return (
    <div className="space-y-8">
      {/* Feedback alerts */}
      {feedback?.error && (
        <div className="border-danger-border bg-danger-bg text-12 text-danger-text flex items-center gap-3 rounded-lg border p-4 font-medium">
          <AlertCircle className="text-danger-text h-4 w-4 shrink-0" />
          <span>{feedback.error}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-danger-text hover:text-danger-text ml-auto"
          >
            ×
          </button>
        </div>
      )}

      {feedback?.success && (
        <div className="border-success-border bg-success-bg text-12 text-success-text space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="text-success-solid h-4 w-4" />
              <span>{feedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-success-solid hover:text-success-text font-bold"
            >
              ×
            </button>
          </div>
          {feedback.rawToken && (
            <div className="bg-surface-card border-success-border mt-2 flex items-center justify-between gap-3 rounded-md border p-2.5">
              <div className="text-11 text-text truncate font-mono select-all">
                {feedback.rawToken}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(feedback.rawToken!)}
                className="bg-primary hover:bg-primary-hover text-on-primary text-11 flex shrink-0 items-center gap-1 rounded-sm px-2 py-1 font-medium transition"
              >
                {copiedToken === feedback.rawToken ? (
                  <>
                    <Check className="h-3 w-3" />
                    <span>Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copiar Token</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quota Banner */}
      <div className="border-card-border bg-surface-card flex flex-col justify-between gap-4 rounded-xl border p-5 shadow-xs md:flex-row md:items-center">
        <div>
          <h2 className="text-16 text-text font-semibold">
            Capacidade de Membros da Empresa
          </h2>
          <p className="text-12 text-text-secondary mt-0.5">
            {organizationName} possui contrato para até {maxSeats} assentos
            ativos ou convites simultâneos.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-18 text-text font-bold">
              {totalOccupiedSeats} / {maxSeats}
            </div>
            <div className="text-11 text-text-secondary">
              {maxSeats - totalOccupiedSeats > 0
                ? `${maxSeats - totalOccupiedSeats} vagas disponíveis`
                : "Limite atingido"}
            </div>
          </div>

          {capabilities.canInvite && (
            <button
              type="button"
              disabled={isSeatLimitReached || isPending}
              onClick={() => setInviteModalOpen(true)}
              className={`text-12 flex items-center gap-2 rounded-lg px-3.5 py-2 font-semibold shadow-xs transition ${
                isSeatLimitReached
                  ? "bg-surface-strong text-text-tertiary cursor-not-allowed"
                  : "bg-primary text-on-primary hover:bg-primary-hover"
              }`}
            >
              <UserPlus className="h-4 w-4" />
              <span>Convidar Membro</span>
            </button>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {inviteModalOpen && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="border-card-border bg-surface-card w-full max-w-md rounded-2xl border p-6 shadow-xl">
            <div className="border-border flex items-center justify-between border-b pb-4">
              <div className="text-text text-14 flex items-center gap-2 font-semibold">
                <UserPlus className="text-text-subtle h-4 w-4" />
                <span>Novo Convite de Membro</span>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="text-text-tertiary hover:text-text-subtle text-18 leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="mt-4 space-y-4">
              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  E-mail do Convidado
                </label>
                <input
                  type="email"
                  required
                  placeholder="usuario@empresa.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="border-border-strong text-12 focus:border-focus-ring w-full rounded-lg border px-3 py-2 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  Papel de Acesso (RBAC)
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(
                      e.target.value as "admin" | "member" | "owner",
                    )
                  }
                  className="border-border-strong text-12 focus:border-focus-ring bg-surface-card w-full rounded-lg border px-3 py-2 focus:outline-none"
                >
                  <option value="member">
                    Membro (Acesso padrão aos módulos)
                  </option>
                  <option value="admin">
                    Administrador (Gestão de membros e configurações)
                  </option>
                  {isOwner && (
                    <option value="owner">
                      Proprietário (Gestão completa e contratação)
                    </option>
                  )}
                </select>
                {!isOwner && (
                  <p className="text-11 text-text-tertiary mt-1">
                    * Apenas proprietários podem convidar outros proprietários
                    (AC04).
                  </p>
                )}
              </div>

              <div className="border-border mt-6 flex items-center justify-end gap-3 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="border-border-strong text-12 text-text-subtle hover:bg-surface-hover rounded-lg border px-3 py-1.5 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="bg-primary text-12 text-on-primary hover:bg-primary-hover rounded-lg px-4 py-1.5 font-semibold disabled:opacity-50"
                >
                  {isPending ? "Gerando..." : "Gerar Convite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Members Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="text-text-secondary h-4 w-4" />
            <h3 className="text-14 text-text font-semibold">
              Membros Ativos ({members.length})
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="text-12 w-full text-left">
            <thead className="bg-surface-raised text-text-secondary border-border border-b font-semibold tracking-wider uppercase">
              <tr>
                <th className="px-5 py-3">Membro</th>
                <th className="px-5 py-3">Papel</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Entrou em</th>
                {capabilities.canManageMembers && (
                  <th className="px-5 py-3 text-right">Ações</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {members.map((member) => {
                const isTargetOwner = member.role === "owner";
                // Admin cannot alter or remove an owner (AC04)
                const canModifyThisMember =
                  capabilities.canManageMembers &&
                  (isOwner ||
                    (!isTargetOwner && member.userId !== currentUserId));

                return (
                  <tr key={member.userId} className="hover:bg-surface-hover">
                    <td className="px-5 py-3.5">
                      <div className="text-text flex items-center gap-2 font-medium">
                        <span>{member.name}</span>
                        {member.isCurrentUser && (
                          <span className="bg-surface-hover text-10 text-text-subtle rounded-xs px-1.5 py-0.5 font-medium">
                            Você
                          </span>
                        )}
                      </div>
                      <div className="text-11 text-text-tertiary font-mono">
                        {member.userId}
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      {canModifyThisMember ? (
                        <select
                          value={member.role}
                          disabled={isPending}
                          onChange={(e) =>
                            handleUpdateRole(
                              member.userId,
                              e.target.value as "owner" | "admin" | "member",
                            )
                          }
                          className="border-border bg-surface-card text-12 text-text rounded-md border px-2 py-1 font-medium focus:outline-none"
                        >
                          <option value="member">Membro</option>
                          <option value="admin">Administrador</option>
                          {isOwner && (
                            <option value="owner">Proprietário</option>
                          )}
                        </select>
                      ) : (
                        <span
                          className={`text-11 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                            member.role === "owner"
                              ? "bg-ai-bg text-ai-text border-ai-border border"
                              : member.role === "admin"
                                ? "bg-info-bg text-info-text border-info-border border"
                                : "bg-surface-hover text-text-subtle"
                          }`}
                        >
                          <Shield className="h-3 w-3" />
                          {member.role === "owner"
                            ? "Proprietário"
                            : member.role === "admin"
                              ? "Administrador"
                              : "Membro"}
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5">
                      <span className="text-success-text text-11 inline-flex items-center gap-1 font-medium">
                        <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                        Ativo
                      </span>
                    </td>

                    <td className="text-text-secondary px-5 py-3.5">
                      {member.joinedAt}
                    </td>

                    {capabilities.canManageMembers && (
                      <td className="px-5 py-3.5 text-right">
                        {canModifyThisMember && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              handleRemoveMember(member.userId, member.name)
                            }
                            className="text-text-tertiary hover:text-danger-text hover:bg-danger-bg rounded-sm p-1 transition"
                            title="Remover membro"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invitations Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-14 text-text font-semibold">
            Convites Pendentes ({invitations.length})
          </h3>
          <span className="text-12 text-text-tertiary">
            Tokens de acesso único com expiração
          </span>
        </div>

        {invitations.length === 0 ? (
          <div className="text-12 text-text-tertiary p-8 text-center">
            Nenhum convite pendente no momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-12 w-full text-left">
              <thead className="bg-surface-raised text-text-secondary border-border border-b font-semibold tracking-wider uppercase">
                <tr>
                  <th className="px-5 py-3">E-mail Convidado</th>
                  <th className="px-5 py-3">Papel Previsto</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Expira em</th>
                  {capabilities.canManageMembers && (
                    <th className="px-5 py-3 text-right">Ações</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {invitations.map((invite) => (
                  <tr key={invite.id} className="hover:bg-surface-hover">
                    <td className="text-text px-5 py-3.5 font-medium">
                      {invite.email}
                    </td>
                    <td className="text-text-subtle px-5 py-3.5 capitalize">
                      {invite.role}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-10 inline-block rounded-full px-2 py-0.5 font-semibold ${
                          invite.status === "pending"
                            ? "bg-warning-bg text-warning-text border-warning-border border"
                            : invite.status === "accepted"
                              ? "bg-success-bg text-success-text"
                              : "bg-surface-hover text-text-secondary"
                        }`}
                      >
                        {invite.status === "pending"
                          ? "Pendente"
                          : invite.status}
                      </span>
                    </td>
                    <td className="text-text-secondary px-5 py-3.5">
                      {invite.expiresAt}
                    </td>
                    {capabilities.canManageMembers && (
                      <td className="px-5 py-3.5 text-right">
                        {invite.status === "pending" && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleRevokeInvite(invite.id)}
                            className="text-12 text-danger-text hover:text-danger-text hover:bg-danger-bg inline-flex items-center gap-1 rounded-sm p-1 font-medium"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Revogar</span>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
