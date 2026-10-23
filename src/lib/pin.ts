import bcrypt from "bcryptjs";
import type { LoungeMemberRole } from "@/lib/db/types";

/**
 * POS PIN codes: 4-6 digits a cashier types on the terminal keypad after picking their name.
 * Stored as a bcrypt hash on the user; brute force is bounded by the lockout below, and PIN
 * sign-in only works on a terminal a signed-in staff member has locked (see pos-terminal.ts).
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PIN_PATTERN = /^\d{4,6}$/;

/** Wrong PINs allowed before the account's PIN sign-in is locked. */
export const PIN_MAX_ATTEMPTS = 5;
/** How long the lock lasts. */
export const PIN_LOCK_MS = 60_000;

/** Lower than passwords (12): a PIN's strength comes from the lockout, and the keypad should feel instant. */
const PIN_HASH_COST = 10;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

/** PINs anyone would try first: one repeated digit (1111) or a straight run (1234, 9876). */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const steps = new Set<number>();
  for (let i = 1; i < pin.length; i++) steps.add(Number(pin[i]) - Number(pin[i - 1]));
  return steps.size === 1 && (steps.has(1) || steps.has(-1));
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error("PIN must be 4-6 digits");
  return bcrypt.hash(pin, PIN_HASH_COST);
}

/** False for a malformed PIN or a missing hash, without throwing. */
export async function verifyPin(pin: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash || !isValidPin(pin)) return false;
  return bcrypt.compare(pin, hash);
}

export interface PinAttemptState {
  failures: number;
  lockedUntil: Date | null;
}

/** Whole seconds until PIN sign-in is allowed again, or 0 when it is allowed now. */
export function pinRetryAfter(state: PinAttemptState, now: Date): number {
  if (!state.lockedUntil) return 0;
  const ms = state.lockedUntil.getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * State after a wrong PIN. The fifth failure in a row locks PIN sign-in for a minute and starts
 * a fresh count, so each further burst of five costs another minute.
 */
export function afterPinFailure(state: PinAttemptState, now: Date): PinAttemptState {
  const failures = state.failures + 1;
  if (failures >= PIN_MAX_ATTEMPTS) return { failures: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MS) };
  return { failures, lockedUntil: null };
}

export const PIN_RESET_STATE: PinAttemptState = { failures: 0, lockedUntil: null };

/** Who may set or remove a lounge member's PIN: owners anyone's, managers cashiers' and their own. */
export function canManagePin(actorRole: LoungeMemberRole, targetRole: LoungeMemberRole, isSelf: boolean): boolean {
  if (actorRole === "OWNER") return true;
  if (actorRole === "MANAGER") return isSelf || targetRole === "STAFF";
  return false;
}
