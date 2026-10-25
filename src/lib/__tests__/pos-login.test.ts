import { describe, expect, it } from "vitest";
import { posCallback, posLoginHref } from "../pos-login";

describe("posLoginHref", () => {
  it("points at the cashier sign-in with the POS page to return to", () => {
    expect(posLoginHref("ar")).toBe("/ar/pos/login?callbackUrl=%2Far%2Fpos");
    expect(posLoginHref("en", "/pos/abc/shifts")).toBe("/en/pos/login?callbackUrl=%2Fen%2Fpos%2Fabc%2Fshifts");
  });
});

describe("posCallback", () => {
  it("keeps POS destinations", () => {
    expect(posCallback("ar", "/ar/pos")).toBe("/ar/pos");
    expect(posCallback("ar", "/en/pos/abc")).toBe("/en/pos/abc");
    expect(posCallback("ar", "/ar/pos/abc/shifts?type=MORNING")).toBe("/ar/pos/abc/shifts?type=MORNING");
  });

  it("keeps management and printout destinations", () => {
    for (const ok of ["/ar/manage", "/en/manage/abc/staff", "/ar/admin", "/ar/receipt/r1", "/ar/shift-report/s1"]) {
      expect(posCallback("ar", ok)).toBe(ok);
    }
  });

  it("falls back to the POS home for anything else", () => {
    for (const bad of [undefined, ["x"], "", "/ar", "/ar/account", "/ar/lounges", "/ar/managex", "//evil.com/ar/pos", "https://evil.com/ar/pos", "/xx/pos", "/ar/pos/login", "/ar/pos/login?callbackUrl=x", "/ar/pos\\evil"]) {
      expect(posCallback("ar", bad)).toBe("/ar/pos");
    }
  });
});
