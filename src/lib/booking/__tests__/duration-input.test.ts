import { describe, expect, it } from "vitest";
import { clampInt, parseDigits, resolveDuration } from "../duration-input";

describe("parseDigits", () => {
  it("reads Latin, Arabic-Indic and Persian digits and Arabic decimal points", () => {
    expect(parseDigits("45")).toBe(45);
    expect(parseDigits("٤٥")).toBe(45);
    expect(parseDigits("۹۰")).toBe(90);
    expect(parseDigits("١٫٥")).toBe(1.5);
    expect(parseDigits("1,5")).toBe(1.5);
  });

  it("rejects empty and malformed input", () => {
    expect(parseDigits("")).toBeNaN();
    expect(parseDigits("1.2.3")).toBeNaN();
    expect(parseDigits("abc")).toBeNaN();
  });
});

describe("clampInt", () => {
  it("clamps players into [min, max]", () => {
    expect(clampInt(0, 1, 4)).toBe(1);
    expect(clampInt(9, 1, 4)).toBe(4);
    expect(clampInt(2.7, 1, 4)).toBe(2);
    expect(clampInt(NaN, 1, 4)).toBeNull();
  });
});

describe("resolveDuration", () => {
  const base = { preset: 60, custom: "", unit: "MIN" as const, maxFixed: 240 };

  it("uses the preset when nothing is typed, falling back to the longest that fits", () => {
    expect(resolveDuration(base)).toEqual({ minutes: 60, rounded: false, error: null });
    expect(resolveDuration({ ...base, preset: 180, maxFixed: 100 }).minutes).toBe(60);
    expect(resolveDuration({ ...base, maxFixed: 20 })).toMatchObject({ minutes: null, error: "SHORT" });
  });

  it("takes typed minutes or hours over the preset", () => {
    expect(resolveDuration({ ...base, custom: "45" })).toEqual({ minutes: 45, rounded: false, error: null });
    expect(resolveDuration({ ...base, custom: "1.5", unit: "HOUR" })).toEqual({ minutes: 90, rounded: false, error: null });
    expect(resolveDuration({ ...base, custom: "٩٠" }).minutes).toBe(90);
  });

  it("rounds to the 5-minute grid and says so", () => {
    expect(resolveDuration({ ...base, custom: "47" })).toEqual({ minutes: 45, rounded: true, error: null });
    expect(resolveDuration({ ...base, custom: "1.33", unit: "HOUR" })).toMatchObject({ minutes: 80, rounded: true });
  });

  it("flags too short and too long", () => {
    expect(resolveDuration({ ...base, custom: "10" }).error).toBe("SHORT");
    expect(resolveDuration({ ...base, custom: "0" }).error).toBe("SHORT");
    expect(resolveDuration({ ...base, custom: "5", unit: "HOUR" }).error).toBe("LONG");
  });
});
