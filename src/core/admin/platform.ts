import { PrismaClient } from "@prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

/**
 * Valid platform admin roles according to specification Section 7:
 * - owner: Platform governance and internal privilege management
 * - operations: Tenant and job operations with bounded permissions
 * - billing: Plans and subscriptions
 * - support: Dedicated audit/support access
 */
export type PlatformAdminRole = "owner" | "operations" | "billing" | "support";

export type PlatformAdminInfo = {
  userId: string;
  role: PlatformAdminRole;
  status: "active" | "inactive";
};

export type AdminMetrics = {
  totalOrganizations: number;
  totalWorkspaces: number;
  totalUsers: number;
};

export type AdminOrganization = {
  id: string;
  name: string;
  status: string;
  maxSeats: number;
  createdAt: Date;
};

export type AdminWorkspace = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
};

export type AdminUser = {
  id: string;
  fullName: string | null;
  status: string;
  createdAt: Date;
};

export class PlatformAdminAccessDeniedError extends Error {
  constructor() {
    super("Access denied: caller is not an active platform administrator");
    this.name = "PlatformAdminAccessDeniedError";
  }
}

/**
 * Checks whether the specified user holds an active PlatformAdminMember role.
 *
 * Maintenance Rationale:
 * - Queries `platform_admin_members` within `withIdentityContext`.
 * - Guarded by `platform_admin_members_select` policy so only the caller's own
 *   active record is visible.
 */
export async function getPlatformAdminMember(
  prisma: PrismaClient,
  userId: string,
): Promise<PlatformAdminInfo | null> {
  return withIdentityContext(prisma, userId, async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        user_id: string;
        role: string;
        status: string;
      }>
    >`
      select user_id, role, status
      from private.get_platform_admin_member()
    `;

    const member = rows[0];
    if (!member || member.status !== "active") {
      return null;
    }

    return {
      userId: member.user_id,
      role: member.role as PlatformAdminRole,
      status: member.status as "active" | "inactive",
    };
  });
}

/**
 * Asserts that the specified user is an active PlatformAdminMember, throwing
 * `PlatformAdminAccessDeniedError` if not.
 */
export async function requirePlatformAdmin(
  prisma: PrismaClient,
  userId: string,
): Promise<PlatformAdminInfo> {
  const admin = await getPlatformAdminMember(prisma, userId);
  if (!admin) {
    throw new PlatformAdminAccessDeniedError();
  }
  return admin;
}

/**
 * Fetches real platform-wide counts for active organizations, workspaces, and users.
 *
 * Maintenance Rationale:
 * - Backed by `private.get_admin_metrics()` which asserts caller's platform admin status
 *   before computing aggregate counts.
 * - Adheres strictly to invariant: "nenhum dado fictício apresentado como métrica real".
 */
export async function getAdminMetrics(
  prisma: PrismaClient,
  userId: string,
): Promise<AdminMetrics> {
  return withIdentityContext(prisma, userId, async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        total_organizations: bigint;
        total_workspaces: bigint;
        total_users: bigint;
      }>
    >`
      select total_organizations, total_workspaces, total_users
      from private.get_admin_metrics()
    `;

    const row = rows[0];
    if (!row) {
      throw new PlatformAdminAccessDeniedError();
    }

    return {
      totalOrganizations: Number(row.total_organizations),
      totalWorkspaces: Number(row.total_workspaces),
      totalUsers: Number(row.total_users),
    };
  });
}

/**
 * Lists registered organizations with quotas and status for platform administrators.
 */
export async function listAdminOrganizations(
  prisma: PrismaClient,
  userId: string,
): Promise<AdminOrganization[]> {
  return withIdentityContext(prisma, userId, async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        name: string;
        status: string;
        max_seats: number;
        created_at: Date;
      }>
    >`
      select id, name, status, max_seats, created_at
      from private.list_admin_organizations()
    `;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      maxSeats: r.max_seats,
      createdAt: new Date(r.created_at),
    }));
  });
}

/**
 * Lists workspaces across all organizations for platform administrators.
 */
export async function listAdminWorkspaces(
  prisma: PrismaClient,
  userId: string,
): Promise<AdminWorkspace[]> {
  return withIdentityContext(prisma, userId, async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        organization_id: string;
        organization_name: string;
        name: string;
        slug: string;
        status: string;
        created_at: Date;
      }>
    >`
      select id, organization_id, organization_name, name, slug, status, created_at
      from private.list_admin_workspaces()
    `;

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      name: r.name,
      slug: r.slug,
      status: r.status,
      createdAt: new Date(r.created_at),
    }));
  });
}

/**
 * Lists user profiles across the platform for platform administrators.
 */
export async function listAdminUsers(
  prisma: PrismaClient,
  userId: string,
): Promise<AdminUser[]> {
  return withIdentityContext(prisma, userId, async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        full_name: string | null;
        status: string;
        created_at: Date;
      }>
    >`
      select id, full_name, status, created_at
      from private.list_admin_users()
    `;

    return rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      status: r.status,
      createdAt: new Date(r.created_at),
    }));
  });
}
