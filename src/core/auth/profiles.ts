import "server-only";

import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { isIdentityStatus, type IdentityStatus } from "./access";

export type ProfileRecord = Readonly<{
  id: string;
  fullName: string | null;
  status: IdentityStatus;
  statusReason: string | null;
  lastSignInAt: Date | null;
}>;

export type ProfileIdentity = Readonly<{
  userId: string;
  email?: string | undefined;
  fullName?: string | undefined;
}>;

type ProfileRow = {
  id: string;
  fullName: string | null;
  status: string;
  statusReason: string | null;
  lastSignInAt: Date | null;
};

/**
 * An unrecognised status is reported as `blocked` instead of being trusted.
 * The column has a CHECK constraint, so this only fires if the database and
 * the application drift apart — and then denying is the safe answer.
 */
function toRecord(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    status: isIdentityStatus(row.status) ? row.status : "blocked",
    statusReason: row.statusReason,
    lastSignInAt: row.lastSignInAt,
  };
}

const SELECTION = {
  id: true,
  fullName: true,
  status: true,
  statusReason: true,
  lastSignInAt: true,
} as const;

/**
 * Reads the server-side status of an identity. This is the check that makes a
 * still-valid JWT useless once the identity is blocked, so it runs on every
 * protected request and never from a cached client-side value.
 */
export async function readProfile(
  userId: string,
): Promise<ProfileRecord | null> {
  const row = await withIdentityContext(prisma, userId, (tx) =>
    tx.profile.findUnique({ where: { id: userId }, select: SELECTION }),
  );

  return row ? toRecord(row) : null;
}

/**
 * Creates the profile on first sign-in and refreshes it on later sign-ins.
 *
 * A blocked identity is never written to: the row is returned as it is so the
 * caller can deny. Allowing the update would both leak the fact that the
 * sign-in worked and fight the RLS policy, which only accepts writes from an
 * active identity.
 */
export async function ensureProfile(
  identity: ProfileIdentity,
): Promise<ProfileRecord> {
  const displayName = identity.fullName?.trim() || identity.email || null;

  return withIdentityContext(prisma, identity.userId, async (tx) => {
    const existing = await tx.profile.findUnique({
      where: { id: identity.userId },
      select: SELECTION,
    });

    if (!existing) {
      const created = await tx.profile.create({
        data: {
          id: identity.userId,
          fullName: displayName,
          lastSignInAt: new Date(),
        },
        select: SELECTION,
      });
      return toRecord(created);
    }

    const current = toRecord(existing);
    if (current.status !== "active") return current;

    const updated = await tx.profile.update({
      where: { id: identity.userId },
      data: {
        lastSignInAt: new Date(),
        ...(current.fullName === null && displayName !== null
          ? { fullName: displayName }
          : {}),
      },
      select: SELECTION,
    });
    return toRecord(updated);
  });
}
