import "server-only";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import type { User } from "@/lib/db/types";
import { db } from "@/server/db";

/**
 * Auth.js adapter on the Firestore `users` / `accounts` collections. Sessions
 * are JWTs, so only the user and account methods are needed (Google sign-in
 * creates or links users through these).
 */

const ACCOUNT_FIELDS = [
  "type",
  "provider",
  "providerAccountId",
  "refresh_token",
  "access_token",
  "expires_at",
  "token_type",
  "scope",
  "id_token",
  "session_state",
] as const;

function toAdapterUser(u: User): AdapterUser & { role: User["role"] } {
  return { id: u.id, name: u.name, email: u.email ?? "", emailVerified: u.emailVerified, image: u.image, role: u.role };
}

export function firestoreAdapter(): Adapter {
  return {
    async createUser(user) {
      const created = await db.user.create({
        data: {
          name: user.name ?? null,
          email: user.email?.toLowerCase() ?? null,
          emailVerified: user.emailVerified ?? null,
          image: user.image ?? null,
        },
      });
      return toAdapterUser(created);
    },
    async getUser(id) {
      const u = await db.user.findUnique({ where: { id } });
      return u ? toAdapterUser(u) : null;
    },
    async getUserByEmail(email) {
      const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
      return u ? toAdapterUser(u) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db.account.findFirst({ where: { provider, providerAccountId }, include: { user: true } });
      return account ? toAdapterUser(account.user) : null;
    },
    async updateUser({ id, ...data }) {
      const u = await db.user.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.email !== undefined ? { email: data.email.toLowerCase() } : {}),
          ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
          ...(data.image !== undefined ? { image: data.image } : {}),
        },
      });
      return toAdapterUser(u);
    },
    async deleteUser(id) {
      await db.user.delete({ where: { id } });
    },
    async linkAccount(account: AdapterAccount) {
      const data: Record<string, unknown> = { userId: account.userId };
      for (const f of ACCOUNT_FIELDS) if (account[f] !== undefined) data[f] = account[f];
      await db.account.create({ data: data as Parameters<typeof db.account.create>[0]["data"] });
    },
    async unlinkAccount({ provider, providerAccountId }) {
      await db.account.deleteMany({ where: { provider, providerAccountId } });
    },
  };
}
