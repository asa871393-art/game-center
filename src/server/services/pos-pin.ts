import "server-only";
import type { LoungeMemberRole } from "@/lib/db/types";
import { canManagePin, hashPin, isWeakPin, PIN_RESET_STATE } from "@/lib/pin";
import { db } from "@/server/db";
import { isStaffRole } from "@/server/staff";
import { PosError, type PosContext } from "./pos";

/** PIN management on the staff screen. */

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
