"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  UserPlus,
  Shield,
  Trash2,
  XCircle,
  Copy,
  Check,
} from "lucide-react";
import {
  createInvitationAction,
  revokeInvitationAction,
  updateMemberRoleAction,
  removeMemberAction,
  setAttendantMarkAction,
  type ActionState,
} from "@/core/workspaces/team-actions";
import { Switch } from "@/components/ui/switch";
import { useStatus } from "@/components/feedback/status-context";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type MemberDisplay = {
  userId: string;
  name: string;
  role: string;
  status: string;
  joinedAt: string;
  isCurrentUser: boolean;
  /**
   * Attendant of the Inbox (IN4a), for who manages it: `fixed` for the
   * Attendant role (always on), `markable` for owners, admins and editors.
   */
  inbox: { marked: boolean; markable: boolean; fixed: boolean } | null;
};

export type InvitationDisplay = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
};

/** Roles offered in the selectors; the Attendant is a workspace role (AT1). */
type TeamRole = "owner" | "admin" | "member" | "attendant";
const TEAM_ROLES: readonly string[] = ["owner", "admin", "member", "attendant"];

export type TeamCapabilities = {
  canManage: boolean;
  canInvite: boolean;
  canManageMembers: boolean;
  canManageInbox: boolean;
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
  const t = useTranslations("team");
  const [isPending, startTransition] = useTransition();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  useActionStatus(feedback);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  // Invite Form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");

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

  const handleRevokeInvite = async (invitationId: string) => {
    const confirmed = await confirmStatus({
      title: t("confirmRevoke"),
      confirmLabel: t("revoke"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("invitationId", invitationId);

      const res = await revokeInvitationAction({}, formData);
      setFeedback(res);
    });
  };

  const handleUpdateRole = (targetUserId: string, newRole: TeamRole) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("targetUserId", targetUserId);
      formData.append("newRole", newRole);

      const res = await updateMemberRoleAction({}, formData);
      setFeedback(res);
    });
  };

  const handleAttendantMark = (targetUserId: string, marked: boolean) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("targetUserId", targetUserId);
      formData.append("marked", String(marked));
      setFeedback(await setAttendantMarkAction({}, formData));
    });
  };

  const handleRemoveMember = async (
    targetUserId: string,
    memberName: string,
  ) => {
    const confirmed = await confirmStatus({
      title: t("removeMember"),
      message: t("confirmRemove", { name: memberName }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("removeMember"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
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
      {/* The invitation link stays on the page to copy (ADR 0016). */}
      {feedback?.success && (feedback.inviteUrl || feedback.rawToken) && (
        <div className="border-success-border bg-success-bg text-12 text-success-text space-y-2 rounded-lg border p-4">
          {
            <div className="bg-surface-card border-success-border mt-2 flex items-center justify-between gap-3 rounded-md border p-2.5">
              <div className="text-11 text-text truncate font-mono select-all">
                {feedback.inviteUrl ||
                  (typeof window !== "undefined"
                    ? `${window.location.origin}/invite/${feedback.rawToken}`
                    : `/invite/${feedback.rawToken}`)}
              </div>
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  const linkToCopy =
                    feedback.inviteUrl ||
                    `${window.location.origin}/invite/${feedback.rawToken}`;
                  handleCopy(linkToCopy);
                }}
              >
                {copiedToken ? (
                  <>
                    <Check className="h-3 w-3" />
                    <span>{t("copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>{t("copyLink")}</span>
                  </>
                )}
              </Button>
            </div>
          }
        </div>
      )}

      {/* Quota Banner */}
      <div className="border-card-border bg-surface-card flex flex-col justify-between gap-4 rounded-xl border p-5 shadow-xs md:flex-row md:items-center">
        <div>
          <h2 className="text-16 text-text font-semibold">
            {t("capacityTitle")}
          </h2>
          <p className="text-12 text-text-secondary mt-0.5">
            {t("capacityDescription", {
              organization: organizationName,
              max: maxSeats,
            })}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-18 text-text font-bold">
              {totalOccupiedSeats} / {maxSeats}
            </div>
            <div className="text-11 text-text-secondary">
              {maxSeats - totalOccupiedSeats > 0
                ? t("seatsAvailable", {
                    count: maxSeats - totalOccupiedSeats,
                  })
                : t("limitReached")}
            </div>
          </div>

          {capabilities.canInvite && (
            <Button
              type="button"
              disabled={isSeatLimitReached || isPending}
              onClick={() => setInviteModalOpen(true)}
            >
              <UserPlus />
              <span>{t("inviteMember")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Invite form */}
      <Dialog open={inviteModalOpen} onOpenChange={setInviteModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="text-text-subtle h-4 w-4" />
              <span>{t("newInvitation")}</span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="team-invite-email">{t("inviteeEmail")}</Label>
              <Input
                id="team-invite-email"
                type="email"
                required
                placeholder={t("emailPlaceholder")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="team-invite-role">{t("accessRole")}</Label>
              <NativeSelect
                id="team-invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                className="w-full"
              >
                <NativeSelectOption value="member">
                  {t("roleOptions.member")}
                </NativeSelectOption>
                <NativeSelectOption value="attendant">
                  {t("roleOptions.attendant")}
                </NativeSelectOption>
                <NativeSelectOption value="admin">
                  {t("roleOptions.admin")}
                </NativeSelectOption>
                {isOwner && (
                  <NativeSelectOption value="owner">
                    {t("roleOptions.owner")}
                  </NativeSelectOption>
                )}
              </NativeSelect>
              {!isOwner && (
                <p className="text-11 text-text-tertiary">
                  {t("ownerOnlyHint")}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteModalOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? t("generating") : t("generateInvitation")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Active Members Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="text-text-secondary h-4 w-4" />
            <h3 className="text-14 text-text font-semibold">
              {t("activeMembers", { count: members.length })}
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-12">
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">{t("columns.member")}</TableHead>
                <TableHead className="px-5">{t("columns.role")}</TableHead>
                <TableHead className="px-5">{t("columns.status")}</TableHead>
                <TableHead className="px-5">{t("columns.joinedAt")}</TableHead>
                {capabilities.canManageInbox && (
                  <TableHead className="px-5">{t("columns.inbox")}</TableHead>
                )}
                {capabilities.canManageMembers && (
                  <TableHead className="px-5 text-right">
                    {t("columns.actions")}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isTargetOwner = member.role === "owner";
                // Admin cannot alter or remove an owner (AC04)
                const canModifyThisMember =
                  capabilities.canManageMembers &&
                  (isOwner ||
                    (!isTargetOwner && member.userId !== currentUserId));

                return (
                  <TableRow key={member.userId}>
                    <TableCell className="px-5">
                      <div className="text-text flex items-center gap-2 font-medium">
                        <span>{member.name}</span>
                        {member.isCurrentUser && (
                          <span className="bg-surface-hover text-10 text-text-subtle rounded-xs px-1.5 py-0.5 font-medium">
                            {t("you")}
                          </span>
                        )}
                      </div>
                      <div className="text-11 text-text-tertiary font-mono">
                        {member.userId}
                      </div>
                    </TableCell>

                    <TableCell className="px-5">
                      {canModifyThisMember ? (
                        <NativeSelect
                          size="sm"
                          aria-label={t("columns.role")}
                          value={member.role}
                          disabled={isPending}
                          onChange={(e) =>
                            handleUpdateRole(
                              member.userId,
                              e.target.value as TeamRole,
                            )
                          }
                        >
                          <NativeSelectOption value="member">
                            {t("roles.member")}
                          </NativeSelectOption>
                          <NativeSelectOption value="attendant">
                            {t("roles.attendant")}
                          </NativeSelectOption>
                          <NativeSelectOption value="admin">
                            {t("roles.admin")}
                          </NativeSelectOption>
                          {isOwner && (
                            <NativeSelectOption value="owner">
                              {t("roles.owner")}
                            </NativeSelectOption>
                          )}
                        </NativeSelect>
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
                          {t(
                            `roles.${
                              TEAM_ROLES.includes(member.role)
                                ? (member.role as TeamRole)
                                : "member"
                            }`,
                          )}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="px-5">
                      <span className="text-success-text text-11 inline-flex items-center gap-1 font-medium">
                        <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                        {t("active")}
                      </span>
                    </TableCell>

                    <TableCell className="text-text-secondary px-5">
                      {member.joinedAt}
                    </TableCell>

                    {capabilities.canManageInbox && (
                      <TableCell className="px-5">
                        {member.inbox &&
                        (member.inbox.fixed || member.inbox.markable) ? (
                          <Switch
                            aria-label={t("attendantMark", {
                              name: member.name,
                            })}
                            checked={member.inbox.marked}
                            disabled={isPending || member.inbox.fixed}
                            onCheckedChange={(checked) =>
                              handleAttendantMark(member.userId, checked)
                            }
                          />
                        ) : null}
                      </TableCell>
                    )}

                    {capabilities.canManageMembers && (
                      <TableCell className="px-5 text-right">
                        {canModifyThisMember && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={isPending}
                            onClick={() =>
                              handleRemoveMember(member.userId, member.name)
                            }
                            className="text-text-tertiary hover:text-danger-text hover:bg-danger-bg"
                            title={t("removeMember")}
                            aria-label={t("removeMember")}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pending Invitations Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-14 text-text font-semibold">
            {t("pendingInvitations", { count: invitations.length })}
          </h3>
          <span className="text-12 text-text-tertiary">
            {t("pendingInvitationsHint")}
          </span>
        </div>

        {invitations.length === 0 ? (
          <div className="text-12 text-text-tertiary p-8 text-center">
            {t("noPendingInvitations")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-12">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">
                    {t("columns.invitedEmail")}
                  </TableHead>
                  <TableHead className="px-5">
                    {t("columns.plannedRole")}
                  </TableHead>
                  <TableHead className="px-5">{t("columns.status")}</TableHead>
                  <TableHead className="px-5">
                    {t("columns.expiresAt")}
                  </TableHead>
                  {capabilities.canManageMembers && (
                    <TableHead className="px-5 text-right">
                      {t("columns.actions")}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="text-text px-5 font-medium">
                      {invite.email}
                    </TableCell>
                    <TableCell className="text-text-subtle px-5 capitalize">
                      {TEAM_ROLES.includes(invite.role)
                        ? t(`roles.${invite.role as TeamRole}`)
                        : invite.role}
                    </TableCell>
                    <TableCell className="px-5">
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
                          ? t("pending")
                          : invite.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-text-secondary px-5">
                      {invite.expiresAt}
                    </TableCell>
                    {capabilities.canManageMembers && (
                      <TableCell className="px-5 text-right">
                        {invite.status === "pending" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isPending}
                            onClick={() => handleRevokeInvite(invite.id)}
                            className="text-danger-text hover:text-danger-text hover:bg-danger-bg"
                          >
                            <XCircle />
                            <span>{t("revoke")}</span>
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
