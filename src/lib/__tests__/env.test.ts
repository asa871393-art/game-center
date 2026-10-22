import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(40);
const saved = { ...process.env };

/** Imports env.ts fresh with only the given secrets set. */
async function loadEnv(vars: { AUTH_SECRET?: string; NEXTAUTH_SECRET?: string }) {
  vi.resetModules();
  delete process.env.AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  Object.assign(process.env, vars);
  return import("../env");
}

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("auth secret", () => {
  it("uses AUTH_SECRET", async () => {
    expect((await loadEnv({ AUTH_SECRET: SECRET_A })).authSecret).toBe(SECRET_A);
  });

  it("falls back to NEXTAUTH_SECRET, and prefers AUTH_SECRET when both are set", async () => {
    expect((await loadEnv({ NEXTAUTH_SECRET: SECRET_B })).authSecret).toBe(SECRET_B);
    expect((await loadEnv({ AUTH_SECRET: SECRET_A, NEXTAUTH_SECRET: SECRET_B })).authSecret).toBe(SECRET_A);
    // Blank counts as unset, so an empty AUTH_SECRET doesn't hide a real NEXTAUTH_SECRET.
    expect((await loadEnv({ AUTH_SECRET: "  ", NEXTAUTH_SECRET: SECRET_B })).authSecret).toBe(SECRET_B);
  });

  it("refuses to start without a usable secret", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadEnv({})).rejects.toThrow("Invalid environment variables");
    await expect(loadEnv({ NEXTAUTH_SECRET: "too-short" })).rejects.toThrow("Invalid environment variables");
    await expect(loadEnv({ AUTH_SECRET: "replace-with-a-32+-character-random-string" })).rejects.toThrow(
      "Invalid environment variables",
    );
  });
});
