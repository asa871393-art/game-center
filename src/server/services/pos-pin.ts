import "server-only";
import type { LoungeMemberRole } from "@/lib/db/types";
import {
  afterPinFailure,
  canManagePin,
  hashPin,
  isWeakPin,
  PIN_MAX_ATTEMPTS,
  PIN_RESET_STATE,
  pinRetryAfter,
  verifyPin,
  type PinAttemptState,
} from "@/lib/pin";
import { db } from "@/server/db";
import { isStaffRole } from "@/server/staff";
import { PosError, type PosContext } from "./pos";

/** PIN sign-in at a lounge's cashier terminal, and the PIN management on the staff screen. */

/** bcrypt hash of a throwaway PIN, compared for unknown users so timing doesn't reveal them. */
const DUMMY_PIN_HASH = "$2b$10$hlEseuSOpEIgGokDwnkBXefuhTIuIAzvvJxbXsy291oCbwTSgGJw.";

export interface PinStaffMember {
  userId: string;
  name: string;
  image: string | null;
  role: LoungeMemberRole;
}

/** Who can sign in by PIN at this lounge: active members with a staff account and a PIN set. */
export async function listPinStaff(loungeId: string): Promise<PinStaffMember[]> {
  const members = await db.loungeMember.findMany({
    where: { loungeId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true, image: true, role: true, isActive: true, pinHash: true } } },
  });
  return members
    .filter((m) => m.user.isActive && isStaffRole(m.user.role) && m.user.pinHash)
    .map((m) => ({ userId: m.user.id, name: m.user.name ?? m.user.email?.split("@")[0] ?? "?", image: m.user.image, role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PinCheck =
  | { ok: true; userId: string }
  | { ok: false; reason: "INVALID"; attemptsLeft: number }
  | { ok: false; reason: "LOCKED"; retryAfter: number };

function attemptState(u: { pinFailedAttempts: number | null; pinLockedUntil: Date | null }): PinAttemptState {
  return { failures: u.pinFailedAttempts ?? 0, lockedUntil: u.pinLockedUntil };
}

/**
 * Checks a PIN for a member of the terminal's lounge. Wrong PINs count against the user; the
 * fifth in a row locks PIN sign-in for a minute. A user who can't sign in here (no PIN, not a
 * member, disabled, not staff) gets the same INVALID answer, after the same bcrypt work.
 */
export async function checkStaffPin(input: { loungeId: string; userId: string; pin: string }, now = new Date()): Promise<PinCheck> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      pinHash: true,
      pinFailedAttempts: true,
      pinLockedUntil: true,
      memberships: { where: { loungeId: input.loungeId, isActive: true }, select: { id: true } },
    },
  });
  const eligible = !!user && user.isActive && isStaffRole(user.role) && !!user.pinHash && (user.role === "SUPER_ADMIN" || user.memberships.length > 0);
  if (!eligible) {
    await verifyPin(input.pin, DUMMY_PIN_HASH);
    return { ok: false, reason: "INVALID", attemptsLeft: PIN_MAX_ATTEMPTS };
  }

  const retryAfter = pinRetryAfter(attemptState(user), now);
  if (retryAfter > 0) return { ok: false, reason: "LOCKED", retryAfter };

  const valid = await verifyPin(input.pin, user.pinHash);
  // Read-modify-write in a transaction so parallel guesses can't each see the old count.
  return db.$transaction(async (tx) => {
    const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { pinFailedAttempts: true, pinLockedUntil: true } });
    const state = attemptState(fresh);
    const waiting = pinRetryAfter(state, now);
    if (waiting > 0) return { ok: false, reason: "LOCKED", retryAfter: waiting } as const;
    if (valid) {
      if (state.failures !== 0 || state.lockedUntil) {
        await tx.user.update({ where: { id: user.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
      }
      return { ok: true, userId: user.id } as const;
    }
    const next = afterPinFailure(state, now);
    await tx.user.update({ where: { id: user.id }, data: { pinFailedAttempts: next.failures, pinLockedUntil: next.lockedUntil } });
    return next.lockedUntil
      ? ({ ok: false, reason: "LOCKED", retryAfter: pinRetryAfter(next, now) } as const)
      : ({ ok: false, reason: "INVALID", attemptsLeft: PIN_MAX_ATTEMPTS - next.failures } as const);
  });
}

const PIN_RESET_DATA = { pinFailedAttempts: PIN_RESET_STATE.failures, pinLockedUntil: PIN_RESET_STATE.lockedUntil };

/**
 * Sets (or with `pin: null`, removes) a lounge member's PIN. Owners manage everyone's; managers
 * manage cashiers' and their own. Changing a PIN clears any lockout.
 */
export async function setMemberPin(ctx: PosContext, input: { memberId: string; pin: string | null; actorRole: LoungeMemberRole }) {
  if (input.pin !== null && isWeakPin(input.pin)) throw new PosError("WEAK_PIN");
  const pinHash = input.pin === null ? null : await hashPin(input.pin);
  return db.$transaction(async (tx) => {
    const member = await tx.loungeMember.findUnique({
      where: { id: input.memberId },
      select: { id: true, loungeId: true, userId: true, role: true, isActive: true, user: { select: { role: true } } },
    });
    if (!member || member.loungeId !== ctx.loungeId || !member.isActive) throw new PosError("NOT_FOUND");
    if (!canManagePin(input.actorRole, member.role, member.userId === ctx.actorId)) throw new PosError("FORBIDDEN");
    if (!isStaffRole(member.user.role)) throw new PosError("FORBIDDEN");
    await tx.user.update({ where: { id: member.userId }, data: { pinHash, ...PIN_RESET_DATA } });
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: pinHash ? "staff.pin.set" : "staff.pin.clear",
        entityType: "User",
        entityId: member.userId,
        data: { memberId: member.id },
      },
    });
  });
}
