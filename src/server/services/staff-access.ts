import "server-only";
import type { LoungeMemberRole, Role } from "@/lib/db/types";
import { db, type TxClient } from "@/server/db";
import { isStaffRole } from "@/server/staff";
import { PosError, type PosContext } from "./pos";

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
}

export interface GrantResult {
  userId: string;
  memberId: string;
  /** True when no account existed and one was prepared for the first Google sign-in. */
  created: boolean;
  /** True when an existing customer account was promoted to staff. */
  promoted: boolean;
}

/** Platform role a lounge member needs; never lowers LOUNGE_ADMIN or SUPER_ADMIN. */
function platformRoleFor(current: Role): Role {
  return isStaffRole(current) ? current : "STAFF";
}

async function grantIn(tx: TxClient, loungeId: string, input: GrantInput): Promise<GrantResult> {
  const email = input.email.trim().toLowerCase();
  let user = await tx.user.findUnique({
    where: { email },
    select: { id: true, role: true, isActive: true, emailVerified: true, passwordHash: true },
  });
  let created = false;
  let promoted = false;

  if (!user) {
    // No password: the only way in is Google sign-in with this address (linked by email).
    user = await tx.user.create({
      data: { email, role: "STAFF" },
      select: { id: true, role: true, isActive: true, emailVerified: true, passwordHash: true },
    });
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
  }

  const existing = await tx.loungeMember.findUnique({
    where: { loungeId_userId: { loungeId, userId: user.id } },
    select: { id: true, role: true },
  });
  if (existing?.role === "OWNER") return { userId: user.id, memberId: existing.id, created, promoted };
  const member = existing
    ? await tx.loungeMember.update({ where: { id: existing.id }, data: { role: input.role, isActive: true }, select: { id: true } })
    : await tx.loungeMember.create({ data: { loungeId, userId: user.id, role: input.role }, select: { id: true } });
  return { userId: user.id, memberId: member.id, created, promoted };
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
  role: LoungeMemberRole;
  /** Has signed in with Google at least once (a linked Google account). */
  googleLinked: boolean;
  /** Can sign in with a password too. */
  hasPassword: boolean;
  /** Has a POS PIN for the lock screen keypad. */
  hasPin: boolean;
  accountActive: boolean;
}

/** Active members of a lounge for the staff screen: owners first, then managers, then cashiers. */
export async function listLoungeStaff(loungeId: string): Promise<LoungeStaffRow[]> {
  const members = await db.loungeMember.findMany({
    where: { loungeId, isActive: true },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true, passwordHash: true, pinHash: true, accounts: { select: { provider: true } } } },
    },
  });
  const rank: Record<LoungeMemberRole, number> = { OWNER: 0, MANAGER: 1, STAFF: 2 };
  return members
    .map((m) => ({
      memberId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      googleLinked: m.user.accounts.some((a) => a.provider === "google"),
      hasPassword: m.user.passwordHash !== null,
      hasPin: !!m.user.pinHash,
      accountActive: m.user.isActive,
    }))
    .sort((a, b) => rank[a.role] - rank[b.role] || (a.email ?? "").localeCompare(b.email ?? ""));
}
