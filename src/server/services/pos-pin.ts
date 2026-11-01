import "server-only";
import type { LoungeMemberRole } from "@/lib/db/types";
import {
  afterPinFailure,
  hashPin,
  isWeakPin,
  PIN_MAX_ATTEMPTS,
  PIN_RESET_STATE,
  pinAttemptsLeft,
  pinRetryAfter,
  verifyPin,
  type PinAttemptState,
} from "@/lib/pin";
import { canManageMember } from "@/lib/staff-permissions";
import { db } from "@/server/db";
import { getPrimaryLoungeId, isStaffRole } from "@/server/staff";
import { PosError, type PosContext } from "./pos";

/** PIN sign-in (the only way in, by PIN alone) at the branch, and the PIN management on the staff screens. */

/** bcrypt hash of a throwaway PIN, compared for unknown users so timing doesn't reveal them. */
const DUMMY_PIN_HASH = "$2b$10$hlEseuSOpEIgGokDwnkBXefuhTIuIAzvvJxbXsy291oCbwTSgGJw.";

export interface PinStaffMember {
  userId: string;
  name: string;
  image: string | null;
  role: LoungeMemberRole;
}

const pinUserSelect = { id: true, name: true, email: true, image: true, role: true, isActive: true, pinHash: true } as const;
const displayName = (u: { name: string | null; email: string | null }) => u.name ?? u.email?.split("@")[0] ?? "?";

type PinHolder = PinStaffMember & { pinHash: string };

/**
 * Who can sign in by PIN at this lounge, with their PIN hashes: active members with a staff
 * account and a PIN set, plus super admins with a PIN (they work every lounge, membership or not).
 */
async function listPinHolders(loungeId: string): Promise<PinHolder[]> {
  const [members, admins] = await Promise.all([
    db.loungeMember.findMany({ where: { loungeId, isActive: true }, include: { user: { select: pinUserSelect } } }),
    db.user.findMany({ where: { role: "SUPER_ADMIN", isActive: true }, select: pinUserSelect }),
  ]);
  const staff = new Map<string, PinHolder>();
  for (const m of members) {
    if (m.user.isActive && isStaffRole(m.user.role) && m.user.pinHash) {
      staff.set(m.user.id, { userId: m.user.id, name: displayName(m.user), image: m.user.image, role: m.role, pinHash: m.user.pinHash });
    }
  }
  for (const u of admins) {
    if (u.pinHash && !staff.has(u.id)) staff.set(u.id, { userId: u.id, name: displayName(u), image: u.image, role: "OWNER", pinHash: u.pinHash });
  }
  return [...staff.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The user ids whose PIN is `pin` among those who can sign in at this lounge. PINs are salted
 * hashes, so each one is compared; every hash is checked even after a match so the time taken
 * doesn't depend on whose PIN it is.
 */
async function pinOwners(loungeId: string, pin: string): Promise<string[]> {
  const holders = await listPinHolders(loungeId);
  if (!holders.length) await verifyPin(pin, DUMMY_PIN_HASH);
  const matches = await Promise.all(holders.map((h) => verifyPin(pin, h.pinHash)));
  return holders.filter((_, i) => matches[i]).map((h) => h.userId);
}

/**
 * Refuses a PIN another person at the lounge already uses: the PIN alone says who is signing in,
 * so two people can't share one.
 */
export async function assertPinFree(loungeId: string, pin: string, userId: string) {
  const owners = await pinOwners(loungeId, pin);
  if (owners.some((id) => id !== userId)) throw new PosError("PIN_TAKEN");
}

export interface PinLounge {
  id: string;
  name: string;
  /** How many people can sign in by PIN here; the keypad shows only when someone can. */
  staffCount: number;
}

/** The branch the keypad signs in to; null while there are no lounges. */
export async function getPinLounge(): Promise<PinLounge | null> {
  const loungeId = await getPrimaryLoungeId();
  if (!loungeId) return null;
  const [lounge, staff] = await Promise.all([
    db.lounge.findUnique({ where: { id: loungeId }, select: { id: true, name: true } }),
    listPinHolders(loungeId),
  ]);
  return lounge ? { ...lounge, staffCount: staff.length } : null;
}

export type PinCheck =
  | { ok: true; userId: string }
  | { ok: false; reason: "INVALID"; attemptsLeft: number }
  | { ok: false; reason: "SHARED" }
  | { ok: false; reason: "LOCKED"; retryAfter: number };

function attemptState(u: { pinFailedAttempts?: number | null; pinLockedUntil?: Date | null }): PinAttemptState {
  return { failures: u.pinFailedAttempts ?? 0, lockedUntil: u.pinLockedUntil ?? null };
}

/**
 * Signs in by PIN alone: the PIN says who is at the keypad. Nobody's name is picked, so wrong PINs
 * count against the branch's keypad, and every fifth one locks PIN sign-in at the branch, for
 * longer each time (see afterPinFailure). A PIN two people share (set before PINs had to be
 * unique) signs nobody in, so neither can use the other's account.
 */
export async function checkBranchPin(input: { loungeId: string; pin: string }, now = new Date()): Promise<PinCheck> {
  const lounge = await db.lounge.findUnique({ where: { id: input.loungeId }, select: { id: true, pinFailedAttempts: true, pinLockedUntil: true } });
  if (!lounge) return { ok: false, reason: "INVALID", attemptsLeft: PIN_MAX_ATTEMPTS };

  const retryAfter = pinRetryAfter(attemptState(lounge), now);
  if (retryAfter > 0) return { ok: false, reason: "LOCKED", retryAfter };

  const owners = await pinOwners(input.loungeId, input.pin);
  // Read-modify-write in a transaction so parallel guesses can't each see the old count.
  return db.$transaction(async (tx) => {
    const fresh = await tx.lounge.findUniqueOrThrow({ where: { id: lounge.id }, select: { pinFailedAttempts: true, pinLockedUntil: true } });
    const state = attemptState(fresh);
    const waiting = pinRetryAfter(state, now);
    if (waiting > 0) return { ok: false, reason: "LOCKED", retryAfter: waiting } as const;
    if (owners.length === 1) {
      if (state.failures !== 0 || state.lockedUntil) {
        await tx.lounge.update({ where: { id: lounge.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
      }
      return { ok: true, userId: owners[0] } as const;
    }
    if (owners.length > 1) return { ok: false, reason: "SHARED" } as const;
    const next = afterPinFailure(state, now);
    await tx.lounge.update({ where: { id: lounge.id }, data: { pinFailedAttempts: next.failures, pinLockedUntil: next.lockedUntil } });
    return next.lockedUntil
      ? ({ ok: false, reason: "LOCKED", retryAfter: pinRetryAfter(next, now) } as const)
      : ({ ok: false, reason: "INVALID", attemptsLeft: pinAttemptsLeft(next) } as const);
  });
}

const PIN_RESET_DATA = { pinFailedAttempts: PIN_RESET_STATE.failures, pinLockedUntil: PIN_RESET_STATE.lockedUntil };

/**
 * Sets (or with `pin: null`, removes) a lounge member's PIN. Owners manage everyone's; managers
 * manage cashiers' and their own. Changing a PIN clears any lockout.
 */
export async function setMemberPin(ctx: PosContext, input: { memberId: string; pin: string | null; actorRole: LoungeMemberRole }) {
  if (input.pin !== null && isWeakPin(input.pin)) throw new PosError("WEAK_PIN");
  if (input.pin !== null) {
    const target = await db.loungeMember.findUnique({ where: { id: input.memberId }, select: { userId: true, loungeId: true } });
    if (target && target.loungeId === ctx.loungeId) await assertPinFree(ctx.loungeId, input.pin, target.userId);
  }
  const pinHash = input.pin === null ? null : await hashPin(input.pin);
  return db.$transaction(async (tx) => {
    const member = await tx.loungeMember.findUnique({
      where: { id: input.memberId },
      select: { id: true, loungeId: true, userId: true, role: true, isActive: true, user: { select: { role: true } } },
    });
    if (!member || member.loungeId !== ctx.loungeId || !member.isActive) throw new PosError("NOT_FOUND");
    if (!canManageMember(input.actorRole, member.role, member.userId === ctx.actorId)) throw new PosError("FORBIDDEN");
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
