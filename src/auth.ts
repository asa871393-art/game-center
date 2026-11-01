import "server-only";
import "next-auth/jwt";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { Role } from "@/lib/db/types";
import { authSecret } from "@/lib/env";
import { readPinTicket } from "@/lib/pin-ticket";
import { db } from "@/server/db";
import { getLoungeAccess, getPrimaryLoungeId } from "@/server/staff";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /** The branch this session signed in to. */
      loungeId?: string;
    } & DefaultSession["user"];
  }
  interface User {
    role?: Role;
    loungeId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    loungeId?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Credentials sign-in requires JWT sessions.
  session: { strategy: "jwt" },
  // AUTH_SECRET, or NEXTAUTH_SECRET on deployments configured with the v4 name.
  secret: authSecret,
  // Take the host from the request (the hosting provider's URLs); AUTH_URL / NEXTAUTH_URL override it.
  trustHost: true,
  providers: [
    /**
     * PIN sign-in, the only way in. /api/auth/pos-pin checks the PIN (with its lockout) for a
     * member of the branch, then signs in here with a short-lived ticket signed by the auth
     * secret; nothing else gets one.
     */
    Credentials({
      id: "pos-pin",
      name: "PIN",
      credentials: { ticket: {} },
      async authorize(raw) {
        const userId = readPinTicket(raw?.ticket, authSecret);
        const loungeId = await getPrimaryLoungeId();
        if (!userId || !loungeId) return null;
        // Staff of the branch only (getLoungeAccess also checks the account is active and staff).
        if (!(await getLoungeAccess(userId, loungeId))) return null;
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email, image: user.image, role: user.role, loungeId };
      },
    }),
  ],
  pages: { signIn: "/ar/pos/login", error: "/ar/pos/login" },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
        token.loungeId = user.loungeId;
      } else if (trigger === "update" && token.id) {
        token.role = (await db.user.findUnique({ where: { id: token.id }, select: { role: true } }))?.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      session.user.role = token.role ?? "CUSTOMER";
      if (token.loungeId) session.user.loungeId = token.loungeId;
      return session;
    },
  },
});
