import "server-only";
import { cache } from "react";
import { env } from "@/lib/env";
import type { LoungeMemberRole, Role } from "@/lib/db/types";
import { db } from "@/server/db";

/** Lounge-level permission ladder. */
const RANK: Record<LoungeMemberRole, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };

export interface LoungeAccess {
  loungeId: string;
  /** Effective lounge role; platform super admins act as OWNER. */
  role: LoungeMemberRole;
}

/** Platform roles allowed to work a lounge (POS, dashboard). Customers never are, even with a membership. */
export const STAFF_ROLES: readonly Role[] = ["STAFF", "LOUNGE_ADMIN", "SUPER_ADMIN"];

export function isStaffRole(role: Role | undefined): boolean {
  return role !== undefined && STAFF_ROLES.includes(role);
}

/**
 * The user's platform role from the database, or null for a missing or deactivated account.
 * The POS gate uses this rather than the JWT so access granted (or revoked) by a manager
 * applies on the next page load, without signing out and back in.
 */
export async function getPlatformRole(userId: string): Promise<Role | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  return user?.isActive ? user.role : null;
}

export function hasLoungeRole(access: LoungeAccess, min: LoungeMemberRole): boolean {
  return RANK[access.role] >= RANK[min];
}

/**
 * The single branch this deployment runs: PRIMARY_LOUNGE_ID, or else the oldest lounge. Every
 * POS, dashboard, staff and shift screen is locked to it; null only while there are no lounges.
 */
export const getPrimaryLoungeId = cache(async (): Promise<string | null> => {
  if (env.PRIMARY_LOUNGE_ID) return (await loungeExists(env.PRIMARY_LOUNGE_ID)) ? env.PRIMARY_LOUNGE_ID : null;
  const oldest = await db.lounge.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  return oldest?.id ?? null;
});

/**
 * The user's access to a lounge, from the database (not the JWT), so revoked
 * memberships, role changes and deactivated accounts take effect immediately.
 * Needs a staff platform role (STAFF_ROLES) plus a membership, or SUPER_ADMIN.
 * Only the primary branch can be worked; every other lounge gets null.
 */
export async function getLoungeAccess(userId: string, loungeId: string): Promise<LoungeAccess | null> {
  if (loungeId !== (await getPrimaryLoungeId())) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      isActive: true,
      memberships: { where: { loungeId, isActive: true }, select: { role: true } },
    },
  });
  if (!user?.isActive || !isStaffRole(user.role)) return null;
  // The primary lounge exists (getPrimaryLoungeId checked), so super admins need no further lookup.
  if (user.role === "SUPER_ADMIN") return { loungeId, role: "OWNER" };
  const membership = user.memberships[0];
  return membership ? { loungeId, role: membership.role } : null;
}

export async function loungeExists(loungeId: string): Promise<boolean> {
  return (await db.lounge.count({ where: { id: loungeId } })) > 0;
}

/** The branch the user works at: the primary lounge, when they have access to it. */
export async function getManagedLounge(userId: string) {
  const loungeId = await getPrimaryLoungeId();
  const access = loungeId ? await getLoungeAccess(userId, loungeId) : null;
  if (!access) return null;
  const lounge = await db.lounge.findUnique({ where: { id: access.loungeId }, select: { id: true, name: true, city: true } });
  return lounge ? { ...lounge, role: access.role } : null;
}
