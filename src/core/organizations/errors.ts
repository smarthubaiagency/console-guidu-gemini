/**
 * ============================================================================
 * File: src/core/organizations/errors.ts
 * Module: Organization, Membership & Invitation Domain Errors
 *
 * Maintenance Rationale:
 * - Provides strongly typed, identifiable error classes for business rule
 *   failures across RBAC (AC04), Quota/Seats (AC06) and token life cycles.
 * - Prevents raw database or SQL leakages to the presentation/API layers.
 * ============================================================================
 */

export class LastOwnerCannotBeRemovedError extends Error {
  readonly code = "LAST_OWNER_CANNOT_BE_REMOVED";
  constructor(entityId: string) {
    super(
      `Cannot remove, demote or revoke the last active owner of organization or workspace ${entityId} (AC04)`,
    );
    this.name = "LastOwnerCannotBeRemovedError";
  }
}

export class InsufficientRoleError extends Error {
  readonly code = "INSUFFICIENT_ROLE";
  constructor(action: string, requiredRole: string) {
    super(
      `Access denied: action '${action}' requires at least role '${requiredRole}' (AC04)`,
    );
    this.name = "InsufficientRoleError";
  }
}

export class SeatLimitExceededError extends Error {
  readonly code = "SEAT_LIMIT_EXCEEDED";
  constructor(organizationId: string, maxSeats: number, currentSeats: number) {
    super(
      `Organization ${organizationId} has reached its seat quota of ${maxSeats} (currently using ${currentSeats}) (AC06)`,
    );
    this.name = "SeatLimitExceededError";
  }
}

export class InvitationNotFoundError extends Error {
  readonly code = "INVITATION_NOT_FOUND";
  constructor() {
    super("Invitation token not found or invalid");
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationExpiredError extends Error {
  readonly code = "INVITATION_EXPIRED";
  constructor() {
    super("This invitation has expired (AC06)");
    this.name = "InvitationExpiredError";
  }
}

export class InvitationAlreadyAcceptedError extends Error {
  readonly code = "INVITATION_ALREADY_ACCEPTED";
  constructor() {
    super("This invitation has already been accepted");
    this.name = "InvitationAlreadyAcceptedError";
  }
}

export class InvitationRevokedError extends Error {
  readonly code = "INVITATION_REVOKED";
  constructor() {
    super("This invitation was revoked by an administrator");
    this.name = "InvitationRevokedError";
  }
}

export class MemberNotFoundError extends Error {
  readonly code = "MEMBER_NOT_FOUND";
  constructor(userId: string) {
    super(`User ${userId} is not a member of this organization`);
    this.name = "MemberNotFoundError";
  }
}
