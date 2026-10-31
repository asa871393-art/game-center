import { describe, expect, it } from "vitest";
import { isTerminalToken, matchesTerminalCode, terminalToken } from "../terminal";

const secret = "s".repeat(32);

describe("branch code", () => {
  it("accepts the code ignoring case and surrounding spaces", () => {
    expect(matchesTerminalCode("  Lounge-2026 ", "lounge-2026", secret)).toBe(true);
    expect(matchesTerminalCode("lounge-2025", "lounge-2026", secret)).toBe(false);
    expect(matchesTerminalCode(null, "lounge-2026", secret)).toBe(false);
    expect(matchesTerminalCode("", "lounge-2026", secret)).toBe(false);
  });

  it("trusts only cookies issued for the current code and secret", () => {
    const token = terminalToken("lounge-2026", secret);
    expect(isTerminalToken(token, "lounge-2026", secret)).toBe(true);
    expect(isTerminalToken(token, "new-code-2027", secret)).toBe(false);
    expect(isTerminalToken(token, "lounge-2026", "t".repeat(32))).toBe(false);
    expect(isTerminalToken(`${token}x`, "lounge-2026", secret)).toBe(false);
    expect(isTerminalToken(undefined, "lounge-2026", secret)).toBe(false);
  });
});
