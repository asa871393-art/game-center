import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Carries a verified PIN sign-in from /api/auth/pos-pin (which checks the PIN and its lockout) to
 * the Auth.js "pos-pin" provider. HMAC-SHA256 with the auth secret, expiring within a minute, so
 * the provider can't be driven directly.
 */

export const PIN_TICKET_TTL_MS = 60_000;
const PURPOSE = "pos-pin-ticket";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}:${payload}`).digest("base64url");
}

export function signPinTicket(userId: string, secret: string, now = new Date()): string {
  const payload = JSON.stringify({ u: userId, e: now.getTime() + PIN_TICKET_TTL_MS });
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload, secret)}`;
}

/** The user a PIN ticket was issued for, or null when it is forged, malformed or expired. */
export function readPinTicket(token: unknown, secret: string, now = new Date()): string | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const payload = Buffer.from(body, "base64url").toString();
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { u, e } = JSON.parse(payload) as { u?: unknown; e?: unknown };
    if (typeof u !== "string" || !u || typeof e !== "number" || e < now.getTime()) return null;
    return u;
  } catch {
    return null;
  }
}
