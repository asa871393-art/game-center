import { describe, expect, it } from "vitest";
import { PIN_TICKET_TTL_MS, readPinTicket, readTerminal, signPinTicket, signTerminal } from "../pos-terminal";

const secret = "test-secret";

describe("terminal cookie", () => {
  it("round-trips the lounge id", () => {
    expect(readTerminal(signTerminal("lounge-1", secret), secret)).toBe("lounge-1");
  });
  it("rejects forged, re-signed or malformed tokens", () => {
    const token = signTerminal("lounge-1", secret);
    expect(readTerminal(token, "other-secret")).toBeNull();
    const [, mac] = token.split(".");
    expect(readTerminal(`${Buffer.from('{"l":"lounge-2"}').toString("base64url")}.${mac}`, secret)).toBeNull();
    expect(readTerminal(`${token}.x`, secret)).toBeNull();
    expect(readTerminal(undefined, secret)).toBeNull();
  });
  it("can't be used as a PIN ticket", () => {
    expect(readPinTicket(signTerminal("user-1", secret), secret)).toBeNull();
  });
});

describe("PIN ticket", () => {
  const now = new Date("2026-10-23T10:00:00Z");

  it("names the user until it expires", () => {
    const ticket = signPinTicket("user-1", secret, now);
    expect(readPinTicket(ticket, secret, now)).toBe("user-1");
    expect(readPinTicket(ticket, secret, new Date(now.getTime() + PIN_TICKET_TTL_MS + 1))).toBeNull();
  });
  it("can't be used as a terminal cookie", () => {
    expect(readTerminal(signPinTicket("lounge-1", secret, now), secret)).toBeNull();
  });
});
