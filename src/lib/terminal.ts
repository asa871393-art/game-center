import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Branch code ("رمز الفرع"): when POS_TERMINAL_CODE is set, only browsers that entered it once
 * see the staff list and PIN keypad. They keep a long-lived cookie holding an HMAC of the code
 * under the auth secret, so the cookie can't be forged, and changing the code (or the secret)
 * signs every terminal out.
 */

export const TERMINAL_COOKIE = "pos_terminal";
/** Browsers cap cookie lifetimes at 400 days. */
export const TERMINAL_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const TERMINAL_CODE_MIN_LENGTH = 8;
const PURPOSE = "pos-terminal";

export function terminalToken(code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}:${code}`).digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Whether a browser's terminal cookie was issued for the current code. */
export function isTerminalToken(token: unknown, code: string, secret: string): boolean {
  return typeof token === "string" && token.length <= 256 && same(token, terminalToken(code, secret));
}

/** Whether a typed branch code matches; spaces around it and letter case are ignored. */
export function matchesTerminalCode(input: unknown, code: string, secret: string): boolean {
  if (typeof input !== "string" || input.length > 256) return false;
  // Compare HMACs so the comparison is fixed-length and constant-time.
  return same(terminalToken(normalizeTerminalCode(input), secret), terminalToken(normalizeTerminalCode(code), secret));
}

export function normalizeTerminalCode(code: string): string {
  return code.trim().toLowerCase();
}
