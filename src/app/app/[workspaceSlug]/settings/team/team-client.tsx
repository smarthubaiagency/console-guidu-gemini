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

interface TeamClientProps {
  workspaceSlug: string;
  currentUserId: string;
  currentUserRole: string;
  organizationName: string;
  maxSeats: number;
  members: MemberDisplay[];
  invitations: InvitationDisplay[];
}

export function TeamClient({
  workspaceSlug,
  currentUserId,
  currentUserRole,
  organizationName,
  maxSeats,
  members,
  invitations,
}: TeamClientProps) {
  const [isPending, startTransition] = useTransition();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  // Invite Form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "owner">("member");

  const canManageTeam = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";

  const activeMembersCount = members.filter((m) => m.status === "active").length;
  const pendingInvitesCount = invitations.filter((i) => i.status === "pending").length;
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

  const handleUpdateRole = (targetUserId: string, newRole: "owner" | "admin" | "member") => {
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
    if (!confirm(`Remover "${memberName}" da organização? O acesso será revogado imediatamente.`)) {
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
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700 animate-in fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{feedback.error}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            ×
          </button>
        </div>
      )}

      {feedback?.success && (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>{feedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-emerald-600 hover:text-emerald-800 font-bold"
            >
              ×
            </button>
          </div>
          {feedback.rawToken && (
            <div className="mt-2 rounded-md bg-white border border-emerald-200 p-2.5 flex items-center justify-between gap-3">
              <div className="font-mono text-[11px] truncate select-all text-neutral-800">
                {feedback.rawToken}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(feedback.rawToken!)}
                className="flex items-center gap-1 shrink-0 rounded bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium transition"
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
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            Capacidade de Membros da Empresa
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {organizationName} possui contrato para até {maxSeats} assentos ativos ou convites simultâneos.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-lg font-bold text-neutral-900">
              {totalOccupiedSeats} / {maxSeats}
            </div>
            <div className="text-[11px] text-neutral-500">
              {maxSeats - totalOccupiedSeats > 0
                ? `${maxSeats - totalOccupiedSeats} vagas disponíveis`
                : "Limite atingido"}
            </div>
          </div>

          {canManageTeam && (
            <button
              type="button"
              disabled={isSeatLimitReached || isPending}
              onClick={() => setInviteModalOpen(true)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition ${
                isSeatLimitReached
                  ? "bg-neutral-300 cursor-not-allowed"
                  : "bg-neutral-900 hover:bg-neutral-800"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
              <div className="flex items-center gap-2 font-semibold text-neutral-900 text-sm">
                <UserPlus className="h-4 w-4 text-neutral-600" />
                <span>Novo Convite de Membro</span>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  E-mail do Convidado
                </label>
                <input
                  type="email"
                  required
                  placeholder="usuario@empresa.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Papel de Acesso (RBAC)
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member" | "owner")}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-neutral-900 focus:outline-none bg-white"
                >
                  <option value="member">Membro (Acesso padrão aos módulos)</option>
                  <option value="admin">Administrador (Gestão de membros e configurações)</option>
                  {isOwner && (
                    <option value="owner">Proprietário (Gestão completa e contratação)</option>
                  )}
                </select>
                {!isOwner && (
                  <p className="mt-1 text-[11px] text-neutral-400">
                    * Apenas proprietários podem convidar outros proprietários (AC04).
                  </p>
                )}
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isPending ? "Gerando..." : "Gerar Convite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Members Table */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-neutral-500" />
            <h3 className="font-semibold text-sm text-neutral-900">
              Membros Ativos ({members.length})
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-semibold border-b border-neutral-200">
              <tr>
                <th className="px-5 py-3">Membro</th>
                <th className="px-5 py-3">Papel</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Entrou em</th>
                {canManageTeam && <th className="px-5 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {members.map((member) => {
                const isTargetOwner = member.role === "owner";
                // Admin cannot alter or remove an owner (AC04)
                const canModifyThisMember =
                  canManageTeam &&
                  (isOwner || (!isTargetOwner && member.userId !== currentUserId));

                return (
                  <tr key={member.userId} className="hover:bg-neutral-50/50">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-neutral-900 flex items-center gap-2">
                        <span>{member.name}</span>
                        {member.isCurrentUser && (
                          <span className="rounded-xs bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 font-medium">
                            Você
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-neutral-400 font-mono">
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
                          className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-800 font-medium focus:outline-none"
                        >
                          <option value="member">Membro</option>
                          <option value="admin">Administrador</option>
                          {isOwner && <option value="owner">Proprietário</option>}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            member.role === "owner"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : member.role === "admin"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-neutral-100 text-neutral-700"
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
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-[11px] font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Ativo
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-neutral-500">
                      {member.joinedAt}
                    </td>

                    {canManageTeam && (
                      <td className="px-5 py-3.5 text-right">
                        {canModifyThisMember && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              handleRemoveMember(member.userId, member.name)
                            }
                            className="text-neutral-400 hover:text-red-600 transition p-1 rounded hover:bg-red-50"
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
      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-neutral-900">
            Convites Pendentes ({invitations.length})
          </h3>
          <span className="text-xs text-neutral-400">
            Tokens de acesso único com expiração
          </span>
        </div>

        {invitations.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-400">
            Nenhum convite pendente no momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-semibold border-b border-neutral-200">
                <tr>
                  <th className="px-5 py-3">E-mail Convidado</th>
                  <th className="px-5 py-3">Papel Previsto</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Expira em</th>
                  {canManageTeam && <th className="px-5 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {invitations.map((invite) => (
                  <tr key={invite.id} className="hover:bg-neutral-50/50">
                    <td className="px-5 py-3.5 font-medium text-neutral-900">
                      {invite.email}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-700 capitalize">
                      {invite.role}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          invite.status === "pending"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : invite.status === "accepted"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {invite.status === "pending" ? "Pendente" : invite.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-neutral-500">
                      {invite.expiresAt}
                    </td>
                    {canManageTeam && (
                      <td className="px-5 py-3.5 text-right">
                        {invite.status === "pending" && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleRevokeInvite(invite.id)}
                            className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium p-1 hover:bg-red-50 rounded"
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
