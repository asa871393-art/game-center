import "server-only";
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

export function hasLoungeRole(access: LoungeAccess, min: LoungeMemberRole): boolean {
  return RANK[access.role] >= RANK[min];
}

/**
 * The user's access to a lounge, from the database (not the JWT), so revoked
 * memberships, role changes and deactivated accounts take effect immediately.
 * Needs a staff platform role (STAFF_ROLES) plus a membership, or SUPER_ADMIN.
 */
export async function getLoungeAccess(userId: string, loungeId: string): Promise<LoungeAccess | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      isActive: true,
      memberships: { where: { loungeId, isActive: true }, select: { role: true } },
    },
  });
  if (!user?.isActive || !isStaffRole(user.role)) return null;
  if (user.role === "SUPER_ADMIN") {
    const exists = await db.lounge.count({ where: { id: loungeId } });
    return exists ? { loungeId, role: "OWNER" } : null;
  }
  const membership = user.memberships[0];
  return membership ? { loungeId, role: membership.role } : null;
}

export async function loungeExists(loungeId: string): Promise<boolean> {
  return (await db.lounge.count({ where: { id: loungeId } })) > 0;
}

/** Lounges the user can open in the dashboard. */
export async function listManagedLounges(userId: string, platformRole: Role) {
  if (!isStaffRole(platformRole)) return [];
  const lounges = await db.lounge.findMany({
    where: platformRole === "SUPER_ADMIN" ? {} : { members: { some: { userId, isActive: true } } },
    orderBy: [{ city: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      city: true,
      status: true,
      members: { where: { userId }, select: { role: true } },
      _count: { select: { devices: { where: { archivedAt: null } } } },
    },
  });
  return lounges.map((l) => ({
    id: l.id,
    name: l.name,
    city: l.city,
    status: l.status,
    role: (l.members[0]?.role ?? "OWNER") as LoungeMemberRole,
    deviceCount: l._count.devices,
  }));
}
