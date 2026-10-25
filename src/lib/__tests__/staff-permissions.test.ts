import { describe, expect, it } from "vitest";
import { canManageMember } from "../staff-permissions";

describe("canManageMember", () => {
  it("lets owners manage anyone and managers cashiers and themselves", () => {
    expect(canManageMember("OWNER", "MANAGER", false)).toBe(true);
    expect(canManageMember("OWNER", "OWNER", true)).toBe(true);
    expect(canManageMember("MANAGER", "STAFF", false)).toBe(true);
    expect(canManageMember("MANAGER", "MANAGER", true)).toBe(true);
    expect(canManageMember("MANAGER", "MANAGER", false)).toBe(false);
    expect(canManageMember("MANAGER", "OWNER", false)).toBe(false);
    expect(canManageMember("STAFF", "STAFF", true)).toBe(false);
  });
});
