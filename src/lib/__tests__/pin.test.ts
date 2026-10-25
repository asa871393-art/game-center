import { describe, expect, it } from "vitest";
import { afterPinFailure, hashPin, isValidPin, isWeakPin, PIN_LOCK_MS, PIN_MAX_LOCK_MS, PIN_RESET_STATE, pinAttemptsLeft, pinRetryAfter, verifyPin } from "../pin";

describe("isValidPin", () => {
  it("accepts 4-6 digits only", () => {
    expect(isValidPin("4821")).toBe(true);
    expect(isValidPin("482193")).toBe(true);
    expect(isValidPin("482")).toBe(false);
    expect(isValidPin("4821937")).toBe(false);
    expect(isValidPin("48a1")).toBe(false);
    expect(isValidPin(4821)).toBe(false);
  });
});

describe("isWeakPin", () => {
  it("flags repeated digits and straight runs", () => {
    for (const pin of ["1111", "000000", "1234", "456789", "9876", "3210"]) expect(isWeakPin(pin)).toBe(true);
  });
  it("allows everything else", () => {
    for (const pin of ["4821", "1235", "1122", "2468", "907312"]) expect(isWeakPin(pin)).toBe(false);
  });
});

describe("hashPin / verifyPin", () => {
  it("round-trips and rejects other PINs", async () => {
    const hash = await hashPin("4821");
    expect(await verifyPin("4821", hash)).toBe(true);
    expect(await verifyPin("4822", hash)).toBe(false);
    expect(await verifyPin("4821", null)).toBe(false);
  });
  it("refuses to hash a malformed PIN", async () => {
    await expect(hashPin("12")).rejects.toThrow();
  });
});

describe("PIN lockout", () => {
  const now = new Date("2026-10-23T10:00:00Z");

  it("locks on the fifth failure, then doubles the lock for every further five", () => {
    let state = PIN_RESET_STATE;
    for (let i = 1; i < 5; i++) {
      state = afterPinFailure(state, now);
      expect(state).toEqual({ failures: i, lockedUntil: null });
      expect(pinAttemptsLeft(state)).toBe(5 - i);
    }
    state = afterPinFailure(state, now);
    expect(state.failures).toBe(5);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + PIN_LOCK_MS);
    expect(pinRetryAfter(state, now)).toBe(60);
    expect(pinAttemptsLeft(state)).toBe(5);

    for (let i = 0; i < 5; i++) state = afterPinFailure(state, now);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + 2 * PIN_LOCK_MS);
    for (let i = 0; i < 5; i++) state = afterPinFailure(state, now);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + 4 * PIN_LOCK_MS);
  });

  it("caps the lock at a day", () => {
    let state = PIN_RESET_STATE;
    for (let i = 0; i < 5 * 20; i++) state = afterPinFailure(state, now);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + PIN_MAX_LOCK_MS);
  });

  it("allows sign-in again once the lock has passed", () => {
    const state = { failures: 0, lockedUntil: new Date(now.getTime() + 1500) };
    expect(pinRetryAfter(state, now)).toBe(2);
    expect(pinRetryAfter(state, new Date(now.getTime() + 1500))).toBe(0);
    expect(pinRetryAfter(PIN_RESET_STATE, now)).toBe(0);
  });
});
