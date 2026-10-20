import { describe, expect, it } from "vitest";
import { applyBps, fromMinor, toMinor } from "../money";

describe("money", () => {
  it("parses decimals to minor units", () => {
    expect(toMinor("12.50")).toBe(1250);
    expect(toMinor("3000")).toBe(300_000);
    expect(toMinor("0.5")).toBe(50);
    expect(toMinor("1.005")).toBe(101);
    expect(toMinor(2.5)).toBe(250);
    expect(toMinor("-4.20")).toBe(-420);
    expect(() => toMinor("abc")).toThrow();
  });

  it("formats minor units as decimal strings", () => {
    expect(fromMinor(1250)).toBe("12.50");
    expect(fromMinor(5)).toBe("0.05");
    expect(fromMinor(-420)).toBe("-4.20");
  });

  it("applies basis points", () => {
    expect(applyBps(10_000, 1500)).toBe(1500);
    expect(applyBps(333, 5000)).toBe(167);
  });
});
