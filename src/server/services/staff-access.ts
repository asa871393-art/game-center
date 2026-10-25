import "server-only";
import type { LoungeMemberRole, Role } from "@/lib/db/types";
import { hashPin, isWeakPin } from "@/lib/pin";
import { canManageMember } from "@/lib/staff-permissions";
import { db, type TxClient } from "@/server/db";
import { isStaffRole } from "@/server/staff";
import { getOpenShift, PosError, type PosContext } from "./pos";

/**
 * Cashier access by email. A lounge manager (or the seed / CLI) names a Google account; the
 * user record is created ahead of time with a staff role, and the first "Sign in with Google"
 * for that address links to it, so the cashier lands on the POS with no password to share.
 */

/** Lounge roles that can be granted here. OWNER stays with the organization owner. */
export type GrantableRole = Extract<LoungeMemberRole, "STAFF" | "MANAGER">;

export interface GrantInput {
  email: string;
  role: GrantableRole;
  /** Filled in on a new account, or where an existing one has none. */
  name?: string | null;
  phone?: string | null;
}

export interface GrantResult {
  userId: string;
  memberId: string;
  /** True when no account existed and one was prepared for the first Google sign-in. */
  created: boolean;
  /** True when an existing customer account was promoted to staff. */
  promoted: boolean;
  /** The member's lounge role afterwards (an existing OWNER stays OWNER). */
  role: LoungeMemberRole;
}

/** Platform role a lounge member needs; never lowers LOUNGE_ADMIN or SUPER_ADMIN. */
function platformRoleFor(current: Role): Role {
  return isStaffRole(current) ? current : "STAFF";
}

async function grantIn(tx: TxClient, loungeId: string, input: GrantInput): Promise<GrantResult> {
  const email = input.email.trim().toLowerCase();
  const select = { id: true, role: true, isActive: true, emailVerified: true, passwordHash: true, name: true, phone: true } as const;
  const name = input.name?.trim() || null;
  const phone = input.phone?.trim() || null;
  let user = await tx.user.findUnique({ where: { email }, select });
  let created = false;
  let promoted = false;

  if (!user) {
    // No password: the only way in is Google sign-in with this address (linked by email).
    user = await tx.user.create({ data: { email, role: "STAFF", name, phone }, select });
    created = true;
  } else {
    if (!user.isActive) throw new PosError("ACCOUNT_DISABLED");
    const role = platformRoleFor(user.role);
    promoted = role !== user.role;
    if (promoted) {
      // Registration doesn't verify emails, so a password on an unverified account may belong to
      // whoever registered the address first. Staff access goes to the Google-verified owner only.
      const dropPassword = !user.emailVerified && user.passwordHash !== null;
      await tx.user.update({ where: { id: user.id }, data: { role, ...(dropPassword ? { passwordHash: null } : {}) } });
    }
    // Never overwrite details the person (or another lounge) already set.
    const fill = { ...(name && !user.name ? { name } : {}), ...(phone && !user.phone ? { phone } : {}) };
    if (Object.keys(fill).length > 0) await tx.user.update({ where: { id: user.id }, data: fill });
  }

  const existing = await tx.loungeMember.findUnique({
    where: { loungeId_userId: { loungeId, userId: user.id } },
    select: { id: true, role: true },
  });
  if (existing?.role === "OWNER") return { userId: user.id, memberId: existing.id, created, promoted, role: "OWNER" };
  const member = existing
    ? await tx.loungeMember.update({ where: { id: existing.id }, data: { role: input.role, isActive: true }, select: { id: true } })
    : await tx.loungeMember.create({ data: { loungeId, userId: user.id, role: input.role }, select: { id: true } });
  return { userId: user.id, memberId: member.id, created, promoted, role: input.role };
}

/** Gives an email address cashier (or manager) access to one lounge. Idempotent. */
export async function grantLoungeAccess(ctx: PosContext | { loungeId: string; actorId: null }, input: GrantInput) {
  return db.$transaction(async (tx) => {
    const result = await grantIn(tx, ctx.loungeId, input);
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: "staff.grant",
        entityType: "LoungeMember",
        entityId: result.memberId,
        data: { email: input.email.trim().toLowerCase(), role: input.role, created: result.created, promoted: result.promoted },
      },
    });
    return result;
  });
}

/**
 * "Add new staff" on the dashboard: grants access like grantLoungeAccess, with the person's name,
 * phone and an optional first PIN. Only owners add managers; a PIN is set only where the actor
 * may manage that member's PIN (so a manager can't set an owner's by re-adding them).
 */
export async function addStaffMember(
  ctx: PosContext,
  input: GrantInput & { pin: string | null; actorRole: LoungeMemberRole },
): Promise<GrantResult> {
  if (input.role === "MANAGER" && input.actorRole !== "OWNER") throw new PosError("FORBIDDEN");
  if (input.pin !== null && isWeakPin(input.pin)) throw new PosError("WEAK_PIN");
  const pinHash = input.pin === null ? null : await hashPin(input.pin);
  return db.$transaction(async (tx) => {
    const result = await grantIn(tx, ctx.loungeId, input);
    if (pinHash) {
      if (!canManageMember(input.actorRole, result.role, result.userId === ctx.actorId)) throw new PosError("FORBIDDEN");
      await tx.user.update({ where: { id: result.userId }, data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null } });
    }
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: "staff.add",
        entityType: "LoungeMember",
        entityId: result.memberId,
        data: { email: input.email.trim().toLowerCase(), role: input.role, created: result.created, promoted: result.promoted, pinSet: !!pinHash },
      },
    });
    return result;
  });
}

/**
 * Edits a member's name, phone and lounge role. Owners edit anyone and change roles; managers
 * edit cashiers and themselves. Owners' roles, and your own, don't change here.
 */
export async function updateStaffMember(
  ctx: PosContext,
  input: { memberId: string; name: string; phone: string | null; role: GrantableRole; actorRole: LoungeMemberRole },
) {
  return db.$transaction(async (tx) => {
    const member = await tx.loungeMember.findUnique({
      where: { id: input.memberId },
      select: { id: true, loungeId: true, userId: true, role: true, isActive: true },
    });
    if (!member || member.loungeId !== ctx.loungeId || !member.isActive) throw new PosError("NOT_FOUND");
    const isSelf = member.userId === ctx.actorId;
    if (!canManageMember(input.actorRole, member.role, isSelf)) throw new PosError("FORBIDDEN");
    const roleChanged = member.role !== "OWNER" && member.role !== input.role;
    if (roleChanged && (isSelf || input.actorRole !== "OWNER")) throw new PosError("FORBIDDEN");

    await tx.user.update({ where: { id: member.userId }, data: { name: input.name.trim(), phone: input.phone?.trim() || null } });
    if (roleChanged) await tx.loungeMember.update({ where: { id: member.id }, data: { role: input.role } });
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: "staff.update",
        entityType: "LoungeMember",
        entityId: member.id,
        data: { userId: member.userId, ...(roleChanged ? { from: member.role, to: input.role } : {}) },
      },
    });
  });
}

/**
 * Removes a member's access to the lounge. Managers remove staff; only owners remove managers;
 * owners are never removed here, and nobody removes themselves (so a lounge can't lose its last manager by accident).
 */
export async function revokeLoungeAccess(ctx: PosContext, input: { memberId: string; actorRole: LoungeMemberRole }) {
  return db.$transaction(async (tx) => {
    const member = await tx.loungeMember.findUnique({ where: { id: input.memberId }, select: { id: true, loungeId: true, userId: true, role: true } });
    if (!member || member.loungeId !== ctx.loungeId) throw new PosError("NOT_FOUND");
    if (member.userId === ctx.actorId) throw new PosError("CANNOT_REMOVE_SELF");
    if (member.role === "OWNER" || (member.role === "MANAGER" && input.actorRole !== "OWNER")) throw new PosError("FORBIDDEN");
    await tx.loungeMember.update({ where: { id: member.id }, data: { isActive: false } });
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: "staff.revoke",
        entityType: "LoungeMember",
        entityId: member.id,
        data: { userId: member.userId, role: member.role },
      },
    });
  });
}

export interface LoungeStaffRow {
  memberId: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: LoungeMemberRole;
  /** Holds the lounge's open cashier shift. */
  onShift: boolean;
  /** Has a PIN, so can sign in. */
  hasPin: boolean;
  accountActive: boolean;
}

/** Active members of a lounge for the staff screen: owners first, then managers, then cashiers. */
export async function listLoungeStaff(loungeId: string): Promise<LoungeStaffRow[]> {
  const [members, shift] = await Promise.all([
    db.loungeMember.findMany({
      where: { loungeId, isActive: true },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, isActive: true, pinHash: true },
        },
      },
    }),
    getOpenShift(db, loungeId),
  ]);
  const rank: Record<LoungeMemberRole, number> = { OWNER: 0, MANAGER: 1, STAFF: 2 };
  return members
    .map((m) => ({
      memberId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      role: m.role,
      onShift: shift?.cashierId === m.userId,
      hasPin: !!m.user.pinHash,
      accountActive: m.user.isActive,
    }))
    .sort((a, b) => rank[a.role] - rank[b.role] || (a.email ?? "").localeCompare(b.email ?? ""));
}
