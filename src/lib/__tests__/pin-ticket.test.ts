import { describe, expect, it } from "vitest";
import { PIN_TICKET_TTL_MS, readPinTicket, signPinTicket } from "../pin-ticket";

const secret = "test-secret";
const now = new Date("2026-10-23T10:00:00Z");

describe("PIN ticket", () => {
  it("names the user until it expires", () => {
    const ticket = signPinTicket("user-1", secret, now);
    expect(readPinTicket(ticket, secret, now)).toBe("user-1");
    expect(readPinTicket(ticket, secret, new Date(now.getTime() + PIN_TICKET_TTL_MS + 1))).toBeNull();
  });

  it("rejects forged, re-signed or malformed tickets", () => {
    const ticket = signPinTicket("user-1", secret, now);
    expect(readPinTicket(ticket, "other-secret", now)).toBeNull();
    const [, mac] = ticket.split(".");
    const other = Buffer.from(JSON.stringify({ u: "user-2", e: now.getTime() + 1000 })).toString("base64url");
    expect(readPinTicket(`${other}.${mac}`, secret, now)).toBeNull();
    expect(readPinTicket(`${ticket}.x`, secret, now)).toBeNull();
    expect(readPinTicket(undefined, secret, now)).toBeNull();
  });
});
