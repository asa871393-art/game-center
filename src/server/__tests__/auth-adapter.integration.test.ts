import type { AdapterAccount } from "next-auth/adapters";
import { afterAll, describe, expect, it } from "vitest";
import { firestoreAdapter } from "@/server/auth-adapter";
import { db, isDbError } from "@/server/db";

/**
 * Google sign-in as Auth.js drives the adapter: look up the Google account, then the
 * email, then create (new person) or link (existing email). The adapter is the only
 * place OAuth users get a Firestore `users` doc, so these cover the whole sync.
 */

const adapter = firestoreAdapter();
const RUN = `oauth-${Date.now()}`;
const createdUserIds: string[] = [];

function googleAccount(userId: string, providerAccountId: string): AdapterAccount {
  return {
    userId,
    type: "oidc",
    provider: "google",
    providerAccountId,
    access_token: "ya29.test",
    token_type: "bearer",
    scope: "openid email profile",
    id_token: "eyJ.test",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
}

/** The error a call rejects with (adapter methods return Awaitable, not Promise). */
async function rejection(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to reject");
}

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("Google sign-in through the Firestore adapter", () => {
  it("creates a CUSTOMER users doc on first sign-in and finds it by the Google account afterwards", async () => {
    const email = `${RUN}-new@test.dev`;
    const sub = `${RUN}-sub-new`;
    expect(await adapter.getUserByAccount!({ provider: "google", providerAccountId: sub })).toBeNull();
    expect(await adapter.getUserByEmail!(email)).toBeNull();

    const user = await adapter.createUser!({ id: "ignored", email, name: "New Googler", image: "https://example.com/a.png", emailVerified: new Date() });
    createdUserIds.push(user.id);
    await adapter.linkAccount!(googleAccount(user.id, sub));

    const doc = await db.user.findUnique({ where: { id: user.id } });
    expect(doc).toMatchObject({ email, name: "New Googler", role: "CUSTOMER", isActive: true, passwordHash: null });
    expect(doc?.createdAt).toBeInstanceOf(Date);
    expect(doc?.emailVerified).toBeInstanceOf(Date);

    expect((await adapter.getUserByAccount!({ provider: "google", providerAccountId: sub }))?.id).toBe(user.id);
  });

  it("links Google to an existing password account with the same email, keeping its role", async () => {
    const email = `${RUN}-existing@test.dev`;
    const existing = await db.user.create({ data: { email, name: "Owner", role: "LOUNGE_ADMIN", passwordHash: "x" } });
    createdUserIds.push(existing.id);

    // Google may report the address with different casing.
    const found = await adapter.getUserByEmail!(email.toUpperCase());
    expect(found?.id).toBe(existing.id);
    await adapter.linkAccount!(googleAccount(existing.id, `${RUN}-sub-existing`));

    const viaGoogle = await adapter.getUserByAccount!({ provider: "google", providerAccountId: `${RUN}-sub-existing` });
    expect(viaGoogle).toMatchObject({ id: existing.id, role: "LOUNGE_ADMIN" });
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("stores emails lowercased and refuses a second users doc for the same address", async () => {
    const email = `${RUN}-Mixed@Test.dev`;
    const user = await adapter.createUser!({ id: "ignored", email, name: null, image: null, emailVerified: null });
    createdUserIds.push(user.id);
    expect(user.email).toBe(email.toLowerCase());

    const duplicate = await rejection(() =>
      adapter.createUser!({ id: "ignored", email: email.toLowerCase(), name: null, image: null, emailVerified: null }),
    );
    expect(isDbError(duplicate, "P2002")).toBe(true);
  });

  it("refuses to link the same Google account twice", async () => {
    const user = await db.user.create({ data: { email: `${RUN}-twice@test.dev` } });
    createdUserIds.push(user.id);
    await adapter.linkAccount!(googleAccount(user.id, `${RUN}-sub-twice`));
    const again = await rejection(() => adapter.linkAccount!(googleAccount(user.id, `${RUN}-sub-twice`)));
    expect(isDbError(again, "P2002")).toBe(true);
  });
});
