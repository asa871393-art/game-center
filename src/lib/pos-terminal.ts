import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed tokens for POS PIN sign-in, HMAC-SHA256 with the auth secret:
 *
 * - The terminal cookie marks a browser as a lounge's cashier terminal. It is set when a
 *   signed-in staff member locks the POS, and PIN sign-in only works where it is present, so
 *   a PIN alone (4-6 digits) is never enough from an arbitrary browser.
 * - The PIN ticket carries a verified PIN sign-in from /api/auth/pos-pin to the Auth.js
 *   "pos-pin" provider. It expires within a minute, so the provider can't be driven directly.
 */

export const POS_TERMINAL_COOKIE = "pos_terminal";
/** A terminal stays registered for a year (renewed on every lock). */
export const POS_TERMINAL_MAX_AGE = 60 * 60 * 24 * 365;
export const PIN_TICKET_TTL_MS = 60_000;

function sign(payload: string, secret: string, purpose: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${payload}`).digest("base64url");
}

function encode(payload: string, secret: string, purpose: string): string {
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload, secret, purpose)}`;
}

function decode(token: unknown, secret: string, purpose: string): string | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const payload = Buffer.from(body, "base64url").toString();
  const expected = Buffer.from(sign(payload, secret, purpose));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected) ? payload : null;
}

export function signTerminal(loungeId: string, secret: string): string {
  return encode(JSON.stringify({ l: loungeId }), secret, "pos-terminal");
}

/** The lounge a terminal cookie was issued for, or null when it is missing or forged. */
export function readTerminal(token: unknown, secret: string): string | null {
  const payload = decode(token, secret, "pos-terminal");
  if (!payload) return null;
  try {
    const { l } = JSON.parse(payload) as { l?: unknown };
    return typeof l === "string" && l.length > 0 ? l : null;
  } catch {
    return null;
  }
}

export function signPinTicket(userId: string, secret: string, now = new Date()): string {
  return encode(JSON.stringify({ u: userId, e: now.getTime() + PIN_TICKET_TTL_MS }), secret, "pos-pin-ticket");
}

/** The user a PIN ticket was issued for, or null when it is forged or expired. */
export function readPinTicket(token: unknown, secret: string, now = new Date()): string | null {
  const payload = decode(token, secret, "pos-pin-ticket");
  if (!payload) return null;
  try {
    const { u, e } = JSON.parse(payload) as { u?: unknown; e?: unknown };
    if (typeof u !== "string" || !u || typeof e !== "number" || e < now.getTime()) return null;
    return u;
  } catch {
    return null;
  }
}
